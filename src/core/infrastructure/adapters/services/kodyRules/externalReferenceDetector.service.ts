import { Injectable } from '@nestjs/common';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    IKodyRuleExternalReference,
    IKodyRuleReferenceSyncError,
} from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
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
    prompt_kodyrules_detect_references_system,
    prompt_kodyrules_detect_references_user,
    kodyRulesDetectReferencesSchema,
    KodyRulesDetectReferencesSchema,
} from '@/shared/utils/langchainCommon/prompts/kodyRulesExternalReferences';
import { createHash } from 'crypto';

interface DetectReferencesParams {
    ruleText: string;
    repositoryId: string;
    repositoryName: string;
    organizationAndTeamData: OrganizationAndTeamData;
    byokConfig?: BYOKConfig;
}

@Injectable()
export class ExternalReferenceDetectorService {
    constructor(
        private readonly promptRunnerService: PromptRunnerService,
        private readonly observabilityService: ObservabilityService,
        private readonly codeManagementService: CodeManagementService,
        private readonly logger: PinoLoggerService,
    ) {}

    async detectAndResolveReferences(params: DetectReferencesParams): Promise<{
        references: IKodyRuleExternalReference[];
        syncErrors?: IKodyRuleReferenceSyncError[];
        ruleHash: string;
    }> {
        try {
            // Calcular hash da regra
            const ruleHash = this.calculateRuleHash(params.ruleText);

            // ✅ Pre-filter: Verificar se tem padrões de referências externas
            if (!this.hasLikelyExternalReferences(params.ruleText)) {
                this.logger.log({
                    message:
                        'No external reference patterns detected (regex pre-filter)',
                    context: ExternalReferenceDetectorService.name,
                    metadata: { ruleHash },
                });
                return { references: [], ruleHash };
            }

            const detectedReferences = await this.detectReferences(params);

            if (!detectedReferences || detectedReferences.length === 0) {
                return { references: [], ruleHash };
            }

            const { references, notFoundDetails } =
                await this.searchFilesInRepository(
                    detectedReferences,
                    params.repositoryId,
                    params.repositoryName,
                    params.organizationAndTeamData,
                );

            return { references, syncErrors: notFoundDetails, ruleHash };
        } catch (error) {
            this.logger.error({
                message: 'Error detecting and resolving external references',
                context: ExternalReferenceDetectorService.name,
                error,
                metadata: {
                    repositoryId: params.repositoryId,
                    organizationAndTeamData: params.organizationAndTeamData,
                },
            });

            let ruleHash: string;
            try {
                ruleHash = this.calculateRuleHash(params.ruleText);
            } catch {
                ruleHash = 'hash_calculation_failed';
            }
            
            return {
                references: [],
                syncErrors: [
                    {
                        fileName: 'unknown',
                        message: `Error during reference detection: ${error.message}`,
                        errorType: 'parsing_error',
                        timestamp: new Date(),
                    },
                ],
                ruleHash,
            };
        }
    }

    private calculateRuleHash(ruleText: string): string {
        return createHash('sha256').update(ruleText).digest('hex');
    }

    private hasLikelyExternalReferences(ruleText: string): boolean {
        const patterns = [
            /@file[:\s]/i,
            /\[\[file:/i,
            /@\w+\.(ts|js|py|md|yml|yaml|json|txt|go|java|cpp|c|h|rs)/i,
            /refer to.*\.(ts|js|py|md|yml|yaml|json|txt)/i,
            /check.*\.(ts|js|py|md|yml|yaml|json|txt)/i,
            /see.*\.(ts|js|py|md|yml|yaml|json|txt)/i,
            /\b\w+\.\w+\.(ts|js|py|md|yml|yaml|json|txt)\b/i,
            /\b[A-Z_][A-Z0-9_]*\.(ts|js|py|md|yml|yaml|json|txt)\b/,
            /\b(readme|contributing|changelog|license|setup|config|package|tsconfig|jest\.config|vite\.config|webpack\.config)\.(md|json|yml|yaml|ts|js)\b/i,
        ];
        return patterns.some((pattern) => pattern.test(ruleText));
    }

    private async detectReferences(
        params: DetectReferencesParams,
    ): Promise<KodyRulesDetectReferencesSchema['references']> {
        const mainProvider = LLMModelProvider.GEMINI_2_5_FLASH;
        const fallbackProvider = LLMModelProvider.GEMINI_2_5_PRO;
        const runName = 'kodyRulesDetectExternalReferences';

        const promptRunner = new BYOKPromptRunnerService(
            this.promptRunnerService,
            mainProvider,
            fallbackProvider,
            params.byokConfig,
        );

        try {
            const { result: raw } =
                await this.observabilityService.runLLMInSpan({
                    spanName: `${ExternalReferenceDetectorService.name}::${runName}`,
                    runName,
                    attrs: {
                        repositoryId: params.repositoryId,
                        organizationId:
                            params.organizationAndTeamData.organizationId,
                        type: promptRunner.executeMode,
                        fallback: false,
                    },
                    exec: async (callbacks) => {
                        return await promptRunner
                            .builder()
                            .setParser(ParserType.STRING)
                            .setPayload({ rule: params.ruleText })
                            .addPrompt({
                                role: PromptRole.SYSTEM,
                                prompt: prompt_kodyrules_detect_references_system(),
                            })
                            .addPrompt({
                                role: PromptRole.USER,
                                prompt: prompt_kodyrules_detect_references_user(
                                    {
                                        rule: params.ruleText,
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

            const parsed = this.extractJsonArray(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }

            this.logger.log({
                message: 'Successfully detected external references',
                context: ExternalReferenceDetectorService.name,
                metadata: {
                    repositoryId: params.repositoryId,
                    referencesCount: parsed.length,
                },
            });

            return parsed;
        } catch (error) {
            this.logger.error({
                message: 'Error calling LLM for reference detection',
                context: ExternalReferenceDetectorService.name,
                error,
                metadata: {
                    repositoryId: params.repositoryId,
                    organizationAndTeamData: params.organizationAndTeamData,
                },
            });
            return [];
        }
    }

    private async searchFilesInRepository(
        detectedReferences: KodyRulesDetectReferencesSchema['references'],
        repositoryId: string,
        repositoryName: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<{
        references: IKodyRuleExternalReference[];
        notFoundDetails: IKodyRuleReferenceSyncError[];
    }> {
        const resolvedReferences: IKodyRuleExternalReference[] = [];
        const notFoundDetails: IKodyRuleReferenceSyncError[] = [];

        const searchResults = await Promise.allSettled(
            detectedReferences.map((ref) =>
                this.findFileWithHybridStrategy(
                    ref,
                    repositoryId,
                    repositoryName,
                    organizationAndTeamData,
                ).then((result) => ({ ref, result })),
            ),
        );

        for (const settlement of searchResults) {
            if (settlement.status === 'fulfilled') {
                const { ref, result } = settlement.value;
                const { found, attemptedPaths } = result;

                if (found.length > 0) {
                    resolvedReferences.push(...found);

                    this.logger.log({
                        message: 'Resolved external reference',
                        context: ExternalReferenceDetectorService.name,
                        metadata: {
                            fileName: ref.fileName,
                            filesFound: found.length,
                            paths: found.map((r) => r.filePath),
                            repositoryName: ref.repositoryName,
                            crossRepo: !!ref.repositoryName,
                        },
                    });
                } else {
                    const fileIdentifier = ref.repositoryName
                        ? `${ref.repositoryName}/${ref.fileName}`
                        : ref.fileName;

                    notFoundDetails.push({
                        fileName: fileIdentifier,
                        message: `File not found in repository${ref.repositoryName ? ` (${ref.repositoryName})` : ''}`,
                        errorType: 'not_found',
                        attemptedPaths,
                        timestamp: new Date(),
                    });

                    this.logger.warn({
                        message: 'No files found for external reference',
                        context: ExternalReferenceDetectorService.name,
                        metadata: {
                            fileName: ref.fileName,
                            repositoryName: ref.repositoryName,
                            attemptedPaths,
                            crossRepo: !!ref.repositoryName,
                            organizationAndTeamData,
                        },
                    });
                }
            } else {
                const error = settlement.reason;
                const refIndex = searchResults.indexOf(settlement);
                const ref = detectedReferences[refIndex];
                const fileIdentifier = ref.repositoryName
                    ? `${ref.repositoryName}/${ref.fileName}`
                    : ref.fileName;

                notFoundDetails.push({
                    fileName: fileIdentifier,
                    message: `Error during file search: ${error.message}`,
                    errorType: 'fetch_error',
                    timestamp: new Date(),
                });

                this.logger.error({
                    message: 'Error searching for external reference file',
                    context: ExternalReferenceDetectorService.name,
                    error,
                    metadata: {
                        reference: ref,
                        repositoryId,
                        repositoryName: ref.repositoryName,
                        crossRepo: !!ref.repositoryName,
                    },
                });
            }
        }

        return { references: resolvedReferences, notFoundDetails };
    }

    private async findFileWithHybridStrategy(
        ref: KodyRulesDetectReferencesSchema['references'][0],
        repositoryId: string,
        repositoryName: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<{
        found: IKodyRuleExternalReference[];
        attemptedPaths: string[];
    }> {
        const filePatterns = this.buildSearchPatterns(ref);

        const found = await this.searchWithPatterns(
            filePatterns,
            repositoryId,
            repositoryName,
            organizationAndTeamData,
            ref,
        );

        return { found, attemptedPaths: filePatterns };
    }

    private buildSearchPatterns(
        ref: KodyRulesDetectReferencesSchema['references'][0],
    ): string[] {
        const patterns: string[] = [];

        if (ref.filePattern) {
            patterns.push(ref.filePattern);
        }

        patterns.push(`**/${ref.fileName}`);

        return [...new Set(patterns)];
    }

    private async searchWithPatterns(
        filePatterns: string[],
        repositoryId: string,
        repositoryName: string,
        organizationAndTeamData: OrganizationAndTeamData,
        ref: KodyRulesDetectReferencesSchema['references'][0],
    ): Promise<IKodyRuleExternalReference[]> {
        try {
            const targetRepoName = ref.repositoryName || repositoryName;
            const targetRepo = {
                id: repositoryId,
                name: targetRepoName,
            };

            this.logger.log({
                message: 'Searching for external reference file',
                context: ExternalReferenceDetectorService.name,
                metadata: {
                    filePatterns,
                    targetRepository: targetRepo,
                    crossRepo: !!ref.repositoryName,
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
                return files.map((file) => {
                    const result: IKodyRuleExternalReference = {
                        filePath: file.path,
                        description: ref.description,
                        lastValidatedAt: new Date(),
                        ...(ref.originalText && {
                            originalText: ref.originalText,
                        }),
                        ...(ref.lineRange &&
                            typeof ref.lineRange.start === 'number' &&
                            typeof ref.lineRange.end === 'number' && {
                                lineRange: {
                                    start: ref.lineRange.start,
                                    end: ref.lineRange.end,
                                },
                            }),
                        ...(ref.repositoryName && {
                            repositoryName: ref.repositoryName,
                        }),
                    };

                    return result;
                });
            }
        } catch (error) {
            this.logger.warn({
                message: 'Pattern search failed for external reference',
                context: ExternalReferenceDetectorService.name,
                error,
                metadata: {
                    filePatterns,
                    repositoryName: ref.repositoryName,
                    crossRepo: !!ref.repositoryName,
                },
            });
        }

        return [];
    }

    private extractJsonArray(text: string | null | undefined): any[] | null {
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
}
