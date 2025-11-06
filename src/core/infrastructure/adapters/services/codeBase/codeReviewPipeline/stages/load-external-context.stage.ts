import { Inject, Injectable } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { PinoLoggerService } from '../../../logger/pino.service';
import type { ContextLayer } from '@context-os-core/interfaces';
import {
    IPromptExternalReferenceManagerService,
    PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN,
} from '@/core/domain/prompts/contracts/promptExternalReferenceManager.contract';
import {
    IPromptContextLoaderService,
    PROMPT_CONTEXT_LOADER_SERVICE_TOKEN,
} from '@/core/domain/prompts/contracts/promptContextLoader.contract';
import { ILoadExternalContextStage } from './contracts/loadExternalContextStage.contract';
import {
    CodeReviewContextPackService,
    SkippedMCPTool,
} from '@/core/infrastructure/adapters/services/context/code-review-context-pack.service';

@Injectable()
export class LoadExternalContextStage
    extends BasePipelineStage<CodeReviewPipelineContext>
    implements ILoadExternalContextStage
{
    readonly stageName = 'LoadExternalContextStage';

    constructor(
        @Inject(PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN)
        private readonly promptReferenceManager: IPromptExternalReferenceManagerService,
        @Inject(PROMPT_CONTEXT_LOADER_SERVICE_TOKEN)
        private readonly promptContextLoader: IPromptContextLoaderService,
        private readonly contextPackService: CodeReviewContextPackService,
        private readonly logger: PinoLoggerService,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        try {
            const { organizationId } = context.organizationAndTeamData;
            const repositoryId = context.repository?.id;
            const directoryId = context.codeReviewConfig?.directoryId;

            const configKeys =
                this.promptReferenceManager.buildConfigKeysHierarchy(
                    context.organizationAndTeamData,
                    repositoryId,
                    directoryId,
                );

            this.logger.log({
                message: 'Loading external prompt context',
                context: this.stageName,
                metadata: {
                    organizationId,
                    repositoryId,
                    directoryId,
                    configKeys,
                    prNumber: context.pullRequest.number,
                },
            });

            const allReferences =
                await this.promptReferenceManager.findByConfigKeys(configKeys);

            const priorityMap = new Map(
                configKeys.map((key, index) => [key, index]),
            );

            const sortedReferences = [...(allReferences ?? [])].sort((a, b) => {
                const aPriority =
                    priorityMap.get(a.configKey) ?? Number.MAX_SAFE_INTEGER;
                const bPriority =
                    priorityMap.get(b.configKey) ?? Number.MAX_SAFE_INTEGER;
                return aPriority - bPriority;
            });

            let externalContext = {};
            let contextLayers: ContextLayer[] | undefined;

            if (sortedReferences.length > 0) {
                const loadResult =
                    await this.promptContextLoader.loadExternalContext(
                        {
                            organizationAndTeamData:
                                context.organizationAndTeamData,
                            repository: context.repository,
                            pullRequest: context.pullRequest,
                            allReferences: sortedReferences,
                        },
                        { buildLayers: true },
                    );

                externalContext = loadResult.externalContext;
                contextLayers = loadResult.contextLayers;

                const totalReferencesLoaded =
                    this.countLoadedReferences(externalContext);

                this.logger.log({
                    message: 'Successfully loaded external prompt context',
                    context: this.stageName,
                    metadata: {
                        organizationId,
                        repositoryId,
                        prNumber: context.pullRequest.number,
                        totalReferences: sortedReferences.length,
                        totalReferencesLoaded,
                    },
                });
            } else {
                this.logger.log({
                    message: 'No external references found for this config',
                    context: this.stageName,
                    metadata: {
                        organizationId,
                        repositoryId,
                        prNumber: context.pullRequest.number,
                    },
                });
            }

            let sharedContextPack = context.sharedContextPack;
            let sharedContextAugmentations = context.sharedContextAugmentations;
            let sharedSanitizedOverrides =
                context.sharedSanitizedOverrides ??
                context.codeReviewConfig?.v2PromptOverrides;
            let updatedCodeReviewConfig = context.codeReviewConfig;

            if (context.codeReviewConfig?.contextReferenceId) {
                try {
                    const resolved =
                        await this.contextPackService.buildContextPack({
                            organizationAndTeamData:
                                context.organizationAndTeamData,
                            overrides:
                                context.codeReviewConfig?.v2PromptOverrides,
                            contextReferenceId:
                                context.codeReviewConfig.contextReferenceId,
                            externalLayers: contextLayers,
                        });

                    if (resolved.sanitizedOverrides) {
                        sharedSanitizedOverrides = resolved.sanitizedOverrides;
                        updatedCodeReviewConfig = {
                            ...context.codeReviewConfig,
                            v2PromptOverrides: resolved.sanitizedOverrides,
                        };
                    }

                    if (resolved.augmentations) {
                        sharedContextAugmentations = resolved.augmentations;
                    }

                    if (resolved.pack) {
                        sharedContextPack = resolved.pack;
                        const skipped = resolved.pack.metadata
                            ?.skippedMcpTools as SkippedMCPTool[] | undefined;
                        if (skipped?.length) {
                            this.logger.warn({
                                message:
                                    'Some MCP tools were skipped due to missing arguments',
                                context: this.stageName,
                                metadata: {
                                    organizationId,
                                    skippedTools: skipped.map((tool) => ({
                                        provider: tool.provider,
                                        toolName: tool.toolName,
                                        missingArgs: tool.missingArgs,
                                        requirementId: tool.requirementId,
                                    })),
                                },
                            });
                        }
                    }
                } catch (error) {
                    this.logger.warn({
                        message: 'Failed to build context pack',
                        context: this.stageName,
                        error,
                        metadata: {
                            organizationId,
                            contextReferenceId:
                                context.codeReviewConfig?.contextReferenceId,
                        },
                    });
                }
            }

            return {
                ...context,
                codeReviewConfig: updatedCodeReviewConfig,
                externalPromptContext: externalContext,
                externalPromptLayers: contextLayers,
                sharedContextPack,
                sharedContextAugmentations,
                sharedSanitizedOverrides,
            };
        } catch (error) {
            this.logger.error({
                message: 'Error loading external context',
                context: this.stageName,
                error,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                },
            });

            return {
                ...context,
                externalPromptContext: {},
                externalPromptLayers: undefined,
                sharedContextPack: undefined,
                sharedContextAugmentations: undefined,
                sharedSanitizedOverrides:
                    context.codeReviewConfig?.v2PromptOverrides,
            };
        }
    }

    /**
     * Counts how many external references were effectively loaded
     * (useful only for logging/observability of the stage).
     */
    private countLoadedReferences(context: any): number {
        let count = 0;

        if (context.customInstructions?.references) {
            count += context.customInstructions.references.length;
        }

        if (context.categories) {
            Object.values(context.categories).forEach((cat: any) => {
                if (cat?.references) {
                    count += cat.references.length;
                }
            });
        }

        if (context.severity) {
            Object.values(context.severity).forEach((sev: any) => {
                if (sev?.references) {
                    count += sev.references.length;
                }
            });
        }

        if (context.generation?.main?.references) {
            count += context.generation.main.references.length;
        }

        return count;
    }
}
