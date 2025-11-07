import { Inject, Injectable } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import {
    CODE_BASE_CONFIG_SERVICE_TOKEN,
    ICodeBaseConfigService,
} from '@/core/domain/codeBase/contracts/CodeBaseConfigService.contract';
import {
    PULL_REQUEST_MANAGER_SERVICE_TOKEN,
    IPullRequestManagerService,
} from '@/core/domain/codeBase/contracts/PullRequestManagerService.contract';
import { PinoLoggerService } from '../../../logger/pino.service';
import {
    AutomationMessage,
    AutomationStatus,
} from '@/core/domain/automation/enums/automation-status';
import {
    DRY_RUN_SERVICE_TOKEN,
    IDryRunService,
} from '@/core/domain/dryRun/contracts/dryRun.service.contract';
import { IPullRequestMessages } from '@/core/domain/pullRequestMessages/interfaces/pullRequestMessages.interface';
import { ConfigLevel } from '@/config/types/general/pullRequestMessages.type';
import {
    IPullRequestMessagesService,
    PULL_REQUEST_MESSAGES_SERVICE_TOKEN,
} from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.service.contract';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';

@Injectable()
export class ResolveConfigStage extends BasePipelineStage<CodeReviewPipelineContext> {
    readonly stageName = 'ResolveConfigStage';

    constructor(
        @Inject(CODE_BASE_CONFIG_SERVICE_TOKEN)
        private readonly codeBaseConfigService: ICodeBaseConfigService,
        @Inject(PULL_REQUEST_MANAGER_SERVICE_TOKEN)
        private readonly pullRequestHandlerService: IPullRequestManagerService,
        @Inject(PULL_REQUEST_MESSAGES_SERVICE_TOKEN)
        private readonly pullRequestMessagesService: IPullRequestMessagesService,
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,

        @Inject(DRY_RUN_SERVICE_TOKEN)
        private readonly dryRunService: IDryRunService,
        private readonly logger: PinoLoggerService,
    ) {
        super();
    }

    protected override async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        try {
            const preliminaryFiles =
                await this.pullRequestHandlerService.getChangedFiles(
                    context.organizationAndTeamData,
                    context.repository,
                    context.pullRequest,
                    [], // Sem ignorePaths ainda, vamos aplicar depois
                    context?.lastExecution?.lastAnalyzedCommit,
                );

            if (!preliminaryFiles || preliminaryFiles.length === 0) {
                this.logger.warn({
                    message: 'No files found in PR',
                    context: this.stageName,
                    metadata: {
                        organizationAndTeamData:
                            context.organizationAndTeamData,
                        repository: context.repository.name,
                        pullRequestNumber: context.pullRequest.number,
                    },
                });

                return this.updateContext(context, (draft) => {
                    draft.statusInfo = {
                        status: AutomationStatus.SKIPPED,
                        message: AutomationMessage.NO_FILES_IN_PR,
                    };
                });
            }

            const config = await this.codeBaseConfigService.getConfig(
                context.organizationAndTeamData,
                context.repository,
                preliminaryFiles,
            );

            const pullRequestMessagesConfig =
                await this.setPullRequestMessagesConfig(context);

            if (context.dryRun?.enabled) {
                const codeReviewConfigId = (
                    await this.parametersService.findByKey(
                        ParametersKey.CODE_REVIEW_CONFIG,
                        context.organizationAndTeamData,
                    )
                ).uuid;

                await this.dryRunService.addConfigsToDryRun({
                    id: context.dryRun.id,
                    organizationAndTeamData: context.organizationAndTeamData,
                    config,
                    configId: codeReviewConfigId,
                    pullRequestMessagesConfig,
                    pullRequestMessagesId: pullRequestMessagesConfig?.uuid,
                });
            }

            return this.updateContext(context, (draft) => {
                draft.codeReviewConfig = config;
                draft.pullRequestMessagesConfig = pullRequestMessagesConfig;
            });
        } catch (error) {
            this.logger.error({
                message: `Error in ResolveConfigStage for PR#${context?.pullRequest?.number}`,
                error,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context?.organizationAndTeamData,
                    prNumber: context?.pullRequest?.number,
                    repositoryId: context?.repository?.id,
                },
            });

            return this.updateContext(context, (draft) => {
                draft.statusInfo = {
                    status: AutomationStatus.SKIPPED,
                    message: AutomationMessage.FAILED_RESOLVE_CONFIG,
                };
            });
        }
    }

    private async setPullRequestMessagesConfig(
        context: CodeReviewPipelineContext,
    ): Promise<IPullRequestMessages | null> {
        const repositoryId = context.repository.id;
        const organizationId = context.organizationAndTeamData.organizationId;

        let pullRequestMessagesConfig = null;

        if (context.codeReviewConfig?.configLevel === ConfigLevel.DIRECTORY) {
            pullRequestMessagesConfig =
                await this.pullRequestMessagesService.findOne({
                    organizationId,
                    repositoryId,
                    directoryId: context.codeReviewConfig?.directoryId,
                    configLevel: ConfigLevel.DIRECTORY,
                });
        }

        if (!pullRequestMessagesConfig) {
            pullRequestMessagesConfig =
                await this.pullRequestMessagesService.findOne({
                    organizationId,
                    repositoryId,
                    configLevel: ConfigLevel.REPOSITORY,
                });
        }

        if (!pullRequestMessagesConfig) {
            pullRequestMessagesConfig =
                await this.pullRequestMessagesService.findOne({
                    organizationId,
                    configLevel: ConfigLevel.GLOBAL,
                });
        }

        return pullRequestMessagesConfig;
    }
}
