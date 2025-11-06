import { Injectable } from '@nestjs/common';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { ObservabilityService } from '@/core/infrastructure/adapters/services/logger/observability.service';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { BYOKPromptRunnerService } from '@/shared/infrastructure/services/tokenTracking/byokPromptRunner.service';
import {
    LLMModelProvider,
    PromptRunnerService,
    ParserType,
    PromptRole,
    BYOKConfig,
} from '@kodus/kodus-common/llm';
import {
    prompt_detect_external_references_system,
    prompt_detect_external_references_user,
    ExternalReferencesDetectionSchema,
} from '@/shared/utils/langchainCommon/prompts/externalReferences';
import {
    IDetectedReference,
    IFileReference,
    PromptReferenceErrorType,
    IPromptReferenceSyncError,
    IFileReferenceError,
} from '@/core/domain/prompts/interfaces/promptExternalReference.interface';
import { IPromptContextEngineService } from '@/core/domain/prompts/contracts/promptContextEngine.contract';
import { createHash } from 'crypto';

@Injectable()
export class PromptContextEngineService
    implements IPromptContextEngineService
{
    constructor(
        private readonly promptRunnerService: PromptRunnerService,
        private readonly observabilityService: ObservabilityService,
        private readonly codeManagementService: CodeManagementService,
        private readonly logger: PinoLoggerService,
    ) {}

    async detectAndResolveReferences(params: {
        promptText: string;
        repositoryId: string;
        repositoryName: string;
        organizationAndTeamData: OrganizationAndTeamData;
        context?: 'rule' | 'instruction' | 'prompt';
        byokConfig?: BYOKConfig;
    }): Promise<{
        references: IFileReference[];
        syncErrors?: IPromptReferenceSyncError[];
    }> {
        try {
            const detectedReferences = await this.detectReferences({
                promptText: params.promptText,
                context: params.context,
                byokConfig: params.byokConfig,
                organizationAndTeamData: params.organizationAndTeamData,
            });

            if (!detectedReferences || detectedReferences.length === 0) {
                return { references: [] };
            }

            const { references, notFoundDetails } =
                await this.searchFilesInRepository(
                    detectedReferences,
                    params.repositoryId,
                    params.repositoryName,
                    params.organizationAndTeamData,
                );

            const syncErrors: IPromptReferenceSyncError[] = notFoundDetails || [];

            return { references, syncErrors };
        } catch (error) {
            this.logger.error({
                message: 'Error detecting and resolving external references',
                context: PromptContextEngineService.name,
                error,
                metadata: {
                    repositoryId: params.repositoryId,
                    organizationAndTeamData: params.organizationAndTeamData,
                },
            });
            
            const syncErrors: IPromptReferenceSyncError[] = [{
                type: PromptReferenceErrorType.DETECTION_FAILED,
                message: `Error during reference detection: ${error.message}`,
                details: {
                    timestamp: new Date(),
                },
            }];

            return {
                references: [],
                syncErrors,
            };
        }
    }

    async detectReferences(params: {
        promptText: string;
        context?: 'rule' | 'instruction' | 'prompt';
        byokConfig?: BYOKConfig;
        organizationAndTeamData: OrganizationAndTeamData;
    }): Promise<IDetectedReference[]> {
        const mainProvider = LLMModelProvider.GEMINI_2_5_FLASH;
        const fallbackProvider = LLMModelProvider.GEMINI_2_5_PRO;
        const runName = 'detectExternalReferences';

        const promptRunner = new BYOKPromptRunnerService(
            this.promptRunnerService,
            mainProvider,
            fallbackProvider,
            params.byokConfig,
        );

        try {
            const { result: raw } =
                await this.observabilityService.runLLMInSpan({
                    spanName: `${PromptContextEngineService.name}::${runName}`,
                    runName,
                    attrs: {
                        organizationId:
                            params.organizationAndTeamData.organizationId,
                        type: promptRunner.executeMode,
                        fallback: false,
                        context: params.context || 'unknown',
                    },
                    exec: async (callbacks) => {
                        return await promptRunner
                            .builder()
                            .setParser(ParserType.STRING)
                            .setPayload({
                                text: params.promptText,
                                context: params.context,
                            })
                            .addPrompt({
                                role: PromptRole.SYSTEM,
                                prompt:
                                    prompt_detect_external_references_system(),
                            })
                            .addPrompt({
                                role: PromptRole.USER,
                                prompt: prompt_detect_external_references_user(
                                    {
                                        text: params.promptText,
                                        context: params.context,
                                    },
                                ),
                            })
                            .addCallbacks(callbacks)
                            .addMetadata({ runName })
                            .setRunName(runName)
                            .execute();
                    },
                });

            if (!raw) {
                return [];
            }

            const parsed = this.extractJsonFromResponse(raw);
            if (!parsed || !Array.isArray(parsed)) {
                return [];
            }

            this.logger.log({
                message: 'Successfully detected external references',
                context: PromptContextEngineService.name,
                metadata: {
                    referencesCount: parsed.length,
                    organizationAndTeamData: params.organizationAndTeamData,
                },
            });

            return parsed;
        } catch (error) {
            this.logger.error({
                message: 'Error calling LLM for reference detection',
                context: PromptContextEngineService.name,
                error,
                metadata: {
                    organizationAndTeamData: params.organizationAndTeamData,
                },
            });
            return [];
        }
    }

    private async searchFilesInRepository(
        detectedReferences: IDetectedReference[],
        repositoryId: string,
        repositoryName: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<{
        references: IFileReference[];
        notFoundDetails: IPromptReferenceSyncError[];
    }> {
        const resolvedReferences: IFileReference[] = [];
        const notFoundDetails: IPromptReferenceSyncError[] = [];

        for (const ref of detectedReferences) {
            try {
                const filePatterns = this.buildSearchPatterns(ref);
                const found = await this.findFileWithHybridStrategy(
                    ref,
                    repositoryId,
                    repositoryName,
                    organizationAndTeamData,
                );

                if (found.length > 0) {
                    resolvedReferences.push(...found);

                    this.logger.log({
                        message: 'Resolved external reference',
                        context: PromptContextEngineService.name,
                        metadata: {
                            fileName: ref.fileName,
                            filesFound: found.length,
                            paths: found.map((r) => r.filePath),
                            repositoryName: ref.repositoryName,
                            crossRepo: !!ref.repositoryName,
                            organizationAndTeamData,
                        },
                    });
                } else {
                    const fileIdentifier = ref.repositoryName
                        ? `${ref.repositoryName}/${ref.fileName}`
                        : ref.fileName;

                    notFoundDetails.push({
                        type: PromptReferenceErrorType.FILE_NOT_FOUND,
                        message: `File not found: ${fileIdentifier}`,
                        details: {
                            fileName: ref.fileName,
                            repositoryName: ref.repositoryName || repositoryName,
                            attemptedPaths: filePatterns,
                            timestamp: new Date(),
                        },
                    });

                    this.logger.warn({
                        message: 'No files found for external reference',
                        context: PromptContextEngineService.name,
                        metadata: {
                            fileName: ref.fileName,
                            repositoryName: ref.repositoryName,
                            crossRepo: !!ref.repositoryName,
                            attemptedPatterns: filePatterns,
                            organizationAndTeamData,
                        },
                    });
                }
            } catch (error) {
                const fileIdentifier = ref.repositoryName
                    ? `${ref.repositoryName}/${ref.fileName}`
                    : ref.fileName;

                notFoundDetails.push({
                    type: PromptReferenceErrorType.FETCH_FAILED,
                    message: `Error searching file: ${error.message}`,
                    details: {
                        fileName: ref.fileName,
                        repositoryName: ref.repositoryName || repositoryName,
                        timestamp: new Date(),
                    },
                });

                this.logger.error({
                    message: 'Error searching for external reference file',
                    context: PromptContextEngineService.name,
                    error,
                    metadata: {
                        reference: ref,
                        repositoryId,
                        repositoryName: ref.repositoryName,
                        crossRepo: !!ref.repositoryName,
                        organizationAndTeamData,
                    },
                });
            }
        }

        return { references: resolvedReferences, notFoundDetails };
    }

    private async findFileWithHybridStrategy(
        ref: IDetectedReference,
        repositoryId: string,
        repositoryName: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<IFileReference[]> {
        const filePatterns = this.buildSearchPatterns(ref);

        return await this.searchWithPatterns(
            filePatterns,
            repositoryId,
            repositoryName,
            organizationAndTeamData,
            ref,
        );
    }

    private buildSearchPatterns(ref: IDetectedReference): string[] {
        const patterns: string[] = [];

        if (ref.filePattern) {
            patterns.push(ref.filePattern);
        }

        const fileName = ref.fileName;
        patterns.push(`**/${fileName}`);

        // Add case-insensitive variations to handle common cases:
        // - CONTRIBUTING.md vs contributing.md
        // - README.MD vs readme.md
        const lowerFileName = fileName.toLowerCase();
        const upperFileName = fileName.toUpperCase();
        
        if (lowerFileName !== fileName) {
            patterns.push(`**/${lowerFileName}`);
        }
        if (upperFileName !== fileName) {
            patterns.push(`**/${upperFileName}`);
        }

        // Capitalize first letter (e.g., Contributing.md)
        const capitalizedFileName = fileName.charAt(0).toUpperCase() + fileName.slice(1).toLowerCase();
        if (capitalizedFileName !== fileName && capitalizedFileName !== lowerFileName && capitalizedFileName !== upperFileName) {
            patterns.push(`**/${capitalizedFileName}`);
        }

        return [...new Set(patterns)];
    }

    private async searchWithPatterns(
        filePatterns: string[],
        repositoryId: string,
        repositoryName: string,
        organizationAndTeamData: OrganizationAndTeamData,
        ref: IDetectedReference,
    ): Promise<IFileReference[]> {
        try {
            const targetRepoName = ref.repositoryName || repositoryName;
            const targetRepo = {
                id: repositoryId,
                name: targetRepoName,
            };

            this.logger.log({
                message: 'Searching for external reference file',
                context: PromptContextEngineService.name,
                metadata: {
                    filePatterns,
                    targetRepository: targetRepo,
                    crossRepo: !!ref.repositoryName,
                    organizationAndTeamData,
                },
            });

            const files =
                await this.codeManagementService.getRepositoryAllFiles({
                    organizationAndTeamData,
                    repository: targetRepo,
                    filters: {
                        filePatterns,
                        maxFiles: 10,
                    },
                });

            if (files && files.length > 0) {
                return files.map((file) => ({
                    filePath: file.path,
                    description: ref.description,
                    originalText: ref.originalText,
                    lineRange: ref.lineRange,
                    ...(ref.repositoryName && {
                        repositoryName: ref.repositoryName,
                    }),
                    lastContentHash: '',
                    lastValidatedAt: new Date(),
                    estimatedTokens: 0,
                }));
            }
        } catch (error) {
            this.logger.warn({
                message: 'Pattern search failed for external reference',
                context: PromptContextEngineService.name,
                error,
                metadata: {
                    filePatterns,
                    repositoryName: ref.repositoryName,
                    crossRepo: !!ref.repositoryName,
                    organizationAndTeamData,
                },
            });
        }

        return [];
    }

    private extractJsonFromResponse(
        text: string | null | undefined,
    ): any[] | null {
        if (!text || typeof text !== 'string') return null;

        let s = text.trim();

        const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenceMatch && fenceMatch[1]) s = fenceMatch[1].trim();

        if (s.startsWith('"') && s.endsWith('"')) {
            try {
                s = JSON.parse(s);
            } catch {}
        }

        const start = s.indexOf('[');
        const end = s.lastIndexOf(']');
        if (start >= 0 && end > start) s = s.slice(start, end + 1);

        try {
            const parsed = JSON.parse(s);
            return Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    calculatePromptHash(promptText: string): string {
        return createHash('sha256').update(promptText).digest('hex');
    }
}

