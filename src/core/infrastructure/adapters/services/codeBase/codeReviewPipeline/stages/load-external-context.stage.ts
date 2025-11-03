import { Inject, Injectable } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { PinoLoggerService } from '../../../logger/pino.service';
import {
    IPromptExternalReferenceManagerService,
    PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN,
} from '@/core/domain/prompts/contracts/promptExternalReferenceManager.contract';
import {
    IPromptContextLoaderService,
    PROMPT_CONTEXT_LOADER_SERVICE_TOKEN,
} from '@/core/domain/prompts/contracts/promptContextLoader.contract';
import { ILoadExternalContextStage } from './contracts/loadExternalContextStage.contract';

@Injectable()
export class LoadExternalContextStage extends BasePipelineStage<CodeReviewPipelineContext> implements ILoadExternalContextStage {
    readonly stageName = 'LoadExternalContextStage';

    constructor(
        @Inject(PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN)
        private readonly promptReferenceManager: IPromptExternalReferenceManagerService,
        @Inject(PROMPT_CONTEXT_LOADER_SERVICE_TOKEN)
        private readonly promptContextLoader: IPromptContextLoaderService,
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
                    organizationId,
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

            if (!allReferences || allReferences.length === 0) {
                this.logger.log({
                    message: 'No external references found for this config',
                    context: this.stageName,
                    metadata: {
                        organizationId,
                        repositoryId,
                        prNumber: context.pullRequest.number,
                    },
                });
                return {
                    ...context,
                    externalPromptContext: {},
                };
            }

            const priorityMap = new Map(
                configKeys.map((key, index) => [key, index]),
            );

            const sortedReferences = [...allReferences].sort((a, b) => {
                const aPriority =
                    priorityMap.get(a.configKey) ?? Number.MAX_SAFE_INTEGER;
                const bPriority =
                    priorityMap.get(b.configKey) ?? Number.MAX_SAFE_INTEGER;
                return aPriority - bPriority;
            });

            const externalContext =
                await this.promptContextLoader.loadExternalContext({
                    organizationAndTeamData: context.organizationAndTeamData,
                    repository: context.repository,
                    pullRequest: context.pullRequest,
                    allReferences: sortedReferences,
                });

            const totalReferencesLoaded = this.countLoadedReferences(
                externalContext,
            );

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

            return {
                ...context,
                externalPromptContext: externalContext,
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
            };
        }
    }

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
