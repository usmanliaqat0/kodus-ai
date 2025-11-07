import { Inject, Injectable } from '@nestjs/common';
import { BasePipelineStage } from '../../../pipeline/base-stage.abstract';
import {
    COMMENT_MANAGER_SERVICE_TOKEN,
    ICommentManagerService,
} from '@/core/domain/codeBase/contracts/CommentManagerService.contract';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { PullRequestMessageStatus } from '@/config/types/general/pullRequestMessages.type';

@Injectable()
export class InitialCommentStage extends BasePipelineStage<CodeReviewPipelineContext> {
    stageName = 'InitialCommentStage';

    constructor(
        @Inject(COMMENT_MANAGER_SERVICE_TOKEN)
        private commentManagerService: ICommentManagerService,

        private readonly logger: PinoLoggerService,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        const pullRequestMessagesConfig = context.pullRequestMessagesConfig;

        if (
            !context.dryRun.enabled &&
            context.lastExecution &&
            context.platformType === PlatformType.GITHUB
        ) {
            this.logger.log({
                message: `Minimizing previous review comment for subsequent review on PR#${context.pullRequest.number}`,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                    repository: context.repository.name,
                    lastExecution: context.lastExecution,
                },
            });

            try {
                await this.commentManagerService.minimizeLastReviewComment(
                    context.organizationAndTeamData,
                    context.pullRequest.number,
                    context.repository,
                    context.platformType,
                );
            } catch (error) {
                this.logger.warn({
                    message: `Failed to minimize previous review comment for PR#${context.pullRequest.number}, continuing with new review`,
                    context: this.stageName,
                    error: error.message,
                    metadata: {
                        organizationAndTeamData:
                            context.organizationAndTeamData,
                        prNumber: context.pullRequest.number,
                    },
                });
            }
        }

        const startReviewMessage =
            pullRequestMessagesConfig?.startReviewMessage;

        if (
            startReviewMessage?.status === PullRequestMessageStatus.OFF ||
            startReviewMessage?.status === PullRequestMessageStatus.INACTIVE
        ) {
            this.logger.log({
                message: `Skipping initial comment for PR#${context.pullRequest.number} because start review message is off or inactive`,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                    repository: context.repository.name,
                    status: startReviewMessage.status,
                },
            });

            return this.updateContext(context, (draft) => {
                draft.pullRequestMessagesConfig = pullRequestMessagesConfig;
            });
        }

        if (
            startReviewMessage?.status ===
                PullRequestMessageStatus.ONLY_WHEN_OPENED &&
            context.lastExecution
        ) {
            this.logger.log({
                message: `Skipping initial comment for PR#${context.pullRequest.number} because it's a subsequent review (ONLY_WHEN_OPENED mode)`,
                context: this.stageName,
                metadata: {
                    organizationAndTeamData: context.organizationAndTeamData,
                    prNumber: context.pullRequest.number,
                    repository: context.repository.name,
                    hasLastExecution: !!context.lastExecution,
                },
            });

            return this.updateContext(context, (draft) => {
                draft.pullRequestMessagesConfig = pullRequestMessagesConfig;
            });
        }

        const result = await this.commentManagerService.createInitialComment(
            context.organizationAndTeamData,
            context.pullRequest.number,
            context.repository,
            context.changedFiles,
            context.codeReviewConfig?.languageResultPrompt ?? 'en-US',
            context.platformType,
            context.codeReviewConfig,
            pullRequestMessagesConfig,
            context.dryRun,
        );

        return this.updateContext(context, (draft) => {
            draft.initialCommentData = result;
        });
    }
}
