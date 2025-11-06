import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
    ContextDependency,
    ContextRequirement,
} from '@context-os-core/interfaces';
import {
    PromptSourceType,
    IDetectedReference,
    IFileReference,
    IPromptReferenceSyncError,
    PromptReferenceErrorType,
} from '@/core/domain/prompts/interfaces/promptExternalReference.interface';
import type { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
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
} from '@/shared/utils/langchainCommon/prompts/externalReferences';
import {
    prompt_kodyrules_detect_references_system,
    prompt_kodyrules_detect_references_user,
} from '@/shared/utils/langchainCommon/prompts/kodyRulesExternalReferences';
import { IPromptContextEngineService } from '@/core/domain/prompts/contracts/promptContextEngine.contract';

interface DetectReferencesParams {
    requirementId: string;
    promptText: string;
    path: string[];
    sourceType: PromptSourceType;
    repositoryId: string;
    repositoryName: string;
    organizationAndTeamData: OrganizationAndTeamData;
    context?: 'rule' | 'instruction' | 'prompt';
    detectionMode?: 'rule' | 'prompt';
    byokConfig?: BYOKConfig;
}

interface DetectionResult {
    references: IFileReference[];
    syncErrors: IPromptReferenceSyncError[];
    detectedMarkers: string[];
    requirements: ContextRequirement[];
    promptHash: string;
}

const DEFAULT_DOMAIN = 'code';
const DEFAULT_INTENT = 'review';

@Injectable()
export class PromptContextEngineService implements IPromptContextEngineService {
    constructor(
        private readonly promptRunnerService: PromptRunnerService,
        private readonly observabilityService: ObservabilityService,
        private readonly codeManagementService: CodeManagementService,
        private readonly logger: PinoLoggerService,
    ) {}

    async detectAndResolveReferences(params: DetectReferencesParams): Promise<{
        references: IFileReference[];
        syncErrors?: IPromptReferenceSyncError[];
        promptHash: string;
        requirements: ContextRequirement[];
        markers: string[];
    }> {
        const detection = await this.runDetection(params);

        return {
            references: detection.references,
            syncErrors: detection.syncErrors,
            promptHash: detection.promptHash,
            requirements: detection.requirements,
            markers: detection.detectedMarkers,
        };
    }

    calculatePromptHash(promptText: string): string {
        return createHash('sha256').update(promptText).digest('hex');
    }

    private async runDetection(
        params: DetectReferencesParams,
    ): Promise<DetectionResult> {
        const promptHash = this.calculatePromptHash(params.promptText);

        if (!this.hasLikelyExternalReferences(params.promptText)) {
            this.logger.debug({
                message:
                    'No external reference patterns detected (regex pre-filter)',
                context: PromptContextEngineService.name,
                metadata: {
                    promptHash,
                    requirementId: params.requirementId,
                    sourceType: params.sourceType,
                },
            });

            const requirement = this.buildRequirement({
                params,
                references: [],
                syncErrors: [],
                markers: [],
                promptHash,
            });

            return {
                references: [],
                syncErrors: [],
                detectedMarkers: [],
                promptHash,
                requirements: requirement ? [requirement] : [],
            };
        }

        try {
            const detectedReferences = await this.detectReferences(params);

            if (!detectedReferences.length) {
                const requirement = this.buildRequirement({
                    params,
                    references: [],
                    syncErrors: [],
                    markers: [],
                    promptHash,
                });

                return {
                    references: [],
                    syncErrors: [],
                    detectedMarkers: [],
                    promptHash,
                    requirements: requirement ? [requirement] : [],
                };
            }

            const { references, notFoundDetails } =
                await this.searchFilesInRepository(detectedReferences, params);

            const markers = this.extractMarkers(params.promptText, references);

            const requirement = this.buildRequirement({
                params,
                references,
                syncErrors: notFoundDetails,
                markers,
                promptHash,
            });

            return {
                references,
                syncErrors: notFoundDetails,
                detectedMarkers: markers,
                promptHash,
                requirements: requirement ? [requirement] : [],
            };
        } catch (error) {
            this.logger.error({
                message: 'Error detecting and resolving external references',
                context: PromptContextEngineService.name,
                error,
                metadata: {
                    requirementId: params.requirementId,
                    repositoryId: params.repositoryId,
                    organizationId:
                        params.organizationAndTeamData.organizationId,
                    sourceType: params.sourceType,
                },
            });

            const syncErrors: IPromptReferenceSyncError[] = [
                {
                    type: PromptReferenceErrorType.DETECTION_FAILED,
                    message: `Error during reference detection: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    details: {
                        timestamp: new Date(),
                    },
                },
            ];

            const requirement = this.buildRequirement({
                params,
                references: [],
                syncErrors,
                markers: [],
                promptHash,
            });

            return {
                references: [],
                syncErrors,
                detectedMarkers: [],
                promptHash,
                requirements: requirement ? [requirement] : [],
            };
        }
    }

    private hasLikelyExternalReferences(promptText: string): boolean {
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

        return patterns.some((pattern) => pattern.test(promptText));
    }

    private async detectReferences(
        params: DetectReferencesParams,
    ): Promise<IDetectedReference[]> {
        const mainProvider = LLMModelProvider.GEMINI_2_5_FLASH;
        const fallbackProvider = LLMModelProvider.GEMINI_2_5_PRO;
        const runName = 'detectExternalReferences';

        const promptRunner = new BYOKPromptRunnerService(
            this.promptRunnerService,
            mainProvider,
            fallbackProvider,
            params.byokConfig,
        );

        const { organizationAndTeamData } = params;

        const { result: raw } = await this.observabilityService.runLLMInSpan({
            spanName: `${PromptContextEngineService.name}::${runName}`,
            runName,
            attrs: {
                organizationId: organizationAndTeamData.organizationId,
                type: promptRunner.executeMode,
                fallback: false,
                context: params.context || 'unknown',
            },
            exec: async (callbacks) => {
                const isRuleMode = params.detectionMode === 'rule';
                const systemPrompt = isRuleMode
                    ? prompt_kodyrules_detect_references_system()
                    : prompt_detect_external_references_system();
                const userPrompt = isRuleMode
                    ? prompt_kodyrules_detect_references_user({
                          rule: params.promptText,
                      })
                    : prompt_detect_external_references_user({
                          text: params.promptText,
                          context: params.context,
                      });

                return await promptRunner
                    .builder()
                    .setParser(ParserType.STRING)
                    .setPayload({
                        text: params.promptText,
                        context: params.context,
                    })
                    .addPrompt({
                        role: PromptRole.SYSTEM,
                        prompt: systemPrompt,
                    })
                    .addPrompt({
                        role: PromptRole.USER,
                        prompt: userPrompt,
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

        this.logger.debug({
            message: 'Detected external references',
            context: PromptContextEngineService.name,
            metadata: {
                referencesCount: parsed.length,
                organizationAndTeamData,
                requirementId: params.requirementId,
            },
        });

        return parsed as IDetectedReference[];
    }

    private async searchFilesInRepository(
        detectedReferences: IDetectedReference[],
        params: DetectReferencesParams,
    ): Promise<{
        references: IFileReference[];
        notFoundDetails: IPromptReferenceSyncError[];
    }> {
        const resolvedReferences: IFileReference[] = [];
        const notFoundDetails: IPromptReferenceSyncError[] = [];

        for (const ref of detectedReferences) {
            try {
                const found = await this.findFileWithHybridStrategy(
                    ref,
                    params.repositoryId,
                    params.repositoryName,
                    params.organizationAndTeamData,
                );

                if (found.length > 0) {
                    resolvedReferences.push(...found);
                    this.logger.debug({
                        message: 'Resolved external reference',
                        context: PromptContextEngineService.name,
                        metadata: {
                            fileName: ref.fileName,
                            filesFound: found.length,
                            paths: found.map((r) => r.filePath),
                            repositoryName: ref.repositoryName,
                            crossRepo: !!ref.repositoryName,
                            organizationAndTeamData:
                                params.organizationAndTeamData,
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
                            repositoryName:
                                ref.repositoryName || params.repositoryName,
                            attemptedPaths: this.buildSearchPatterns(ref),
                            timestamp: new Date(),
                        },
                    });
                }
            } catch (error) {
                notFoundDetails.push({
                    type: PromptReferenceErrorType.FETCH_FAILED,
                    message: `Error searching file: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    details: {
                        fileName: ref.fileName,
                        repositoryName:
                            ref.repositoryName || params.repositoryName,
                        timestamp: new Date(),
                    },
                });

                this.logger.error({
                    message: 'Error searching for external reference file',
                    context: PromptContextEngineService.name,
                    error,
                    metadata: {
                        reference: ref,
                        repositoryId: params.repositoryId,
                        repositoryName: ref.repositoryName,
                        crossRepo: !!ref.repositoryName,
                        organizationAndTeamData: params.organizationAndTeamData,
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

        const lowerFileName = fileName.toLowerCase();
        const upperFileName = fileName.toUpperCase();

        if (lowerFileName !== fileName) {
            patterns.push(`**/${lowerFileName}`);
        }
        if (upperFileName !== fileName) {
            patterns.push(`**/${upperFileName}`);
        }

        const capitalizedFileName =
            fileName.charAt(0).toUpperCase() + fileName.slice(1).toLowerCase();
        if (
            capitalizedFileName !== fileName &&
            capitalizedFileName !== lowerFileName &&
            capitalizedFileName !== upperFileName
        ) {
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
                id: ref.repositoryName ? repositoryId : repositoryId,
                name: targetRepoName,
            };

            this.logger.debug({
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

    private buildRequirement(input: {
        params: DetectReferencesParams;
        references: IFileReference[];
        syncErrors: IPromptReferenceSyncError[];
        markers: string[];
        promptHash: string;
    }): ContextRequirement | null {
        const { params, references, syncErrors, markers, promptHash } = input;

        const dependencies: ContextDependency[] = references.map(
            (reference, index) => ({
                type: 'knowledge',
                id: `${reference.repositoryName ?? params.repositoryName}|${
                    reference.filePath
                }|${index}`,
                metadata: {
                    repositoryId: params.repositoryId,
                    repositoryName:
                        reference.repositoryName ?? params.repositoryName,
                    filePath: reference.filePath,
                    lineRange: reference.lineRange ?? null,
                    description: reference.description,
                    originalText: reference.originalText,
                    detectedAt: new Date().toISOString(),
                },
            }),
        );

        // Extract MCP dependencies from markers
        const mcpDependencies = this.extractMCPDependencies(
            params.promptText,
            params.repositoryId,
        );
        dependencies.push(...mcpDependencies);

        return {
            id: params.requirementId,
            consumer: {
                id: params.requirementId,
                kind: 'prompt_section',
                name: params.sourceType,
                metadata: {
                    path: params.path,
                    sourceType: params.sourceType,
                },
            },
            request: {
                domain: DEFAULT_DOMAIN,
                taskIntent: DEFAULT_INTENT,
                signal: {
                    metadata: {
                        path: params.path,
                        sourceType: params.sourceType,
                    },
                },
            },
            dependencies,
            metadata: {
                path: params.path,
                sourceType: params.sourceType,
                inlineMarkers: markers,
                syncErrors,
                promptHash,
            },
            status: syncErrors.length ? 'draft' : 'active',
        };
    }

    private extractMCPDependencies(
        text: string,
        repositoryId: string,
    ): ContextDependency[] {
        const mcpDependencies: ContextDependency[] = [];
        const mcpRegex = /@mcp<([^|>]+)\|([^>]+)>/g;
        let match;

        this.logger.debug({
            message: 'Extracting MCP dependencies from text',
            context: PromptContextEngineService.name,
            metadata: {
                textLength: text.length,
                textSnippet: text.substring(0, 200),
                repositoryId,
            },
        });

        while ((match = mcpRegex.exec(text)) !== null) {
            const [fullMatch, app, tool] = match;
            this.logger.log({
                message: 'Found MCP dependency',
                context: PromptContextEngineService.name,
                metadata: {
                    fullMatch,
                    app,
                    tool,
                    repositoryId,
                },
            });
            mcpDependencies.push({
                type: 'mcp',
                id: `${app}|${tool}`,
                metadata: {
                    app,
                    tool,
                    originalText: fullMatch,
                    repositoryId,
                    detectedAt: new Date().toISOString(),
                },
            });
        }

        this.logger.debug({
            message: 'MCP extraction completed',
            context: PromptContextEngineService.name,
            metadata: {
                foundCount: mcpDependencies.length,
            },
        });

        return mcpDependencies;
    }

    private extractMarkers(
        promptText: string,
        references: IFileReference[],
    ): string[] {
        const markers = new Set<string>();

        for (const reference of references) {
            if (reference.originalText) {
                markers.add(reference.originalText);
            }
        }

        const fileRegex = /@[A-Za-z0-9/_\-.]+/g;
        const fileMatches = promptText.match(fileRegex);
        if (fileMatches) {
            fileMatches.forEach((match) => markers.add(match));
        }

        // Detect MCP markers: @mcp<app|tool>
        const mcpRegex = /@mcp<([^|>]+)\|([^>]+)>/g;
        let mcpMatch;
        while ((mcpMatch = mcpRegex.exec(promptText)) !== null) {
            markers.add(mcpMatch[0]); // Add the full @mcp<app|tool> marker
        }

        return Array.from(markers.values());
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
            } catch {
                /* ignore */
            }
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
