import { Inject, Injectable } from '@nestjs/common';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';

import {
    IWebhookEventHandler,
    IWebhookEventParams,
} from '@/core/domain/platformIntegrations/interfaces/webhook-event-handler.interface';

@Injectable()
export class ReceiveWebhookUseCase implements IUseCase {
    private readonly webhookHandlersMap: Map<
        PlatformType,
        IWebhookEventHandler
    >;

    constructor(
        @Inject('GITHUB_WEBHOOK_HANDLER')
        private readonly githubPullRequestHandler: IWebhookEventHandler,

        @Inject('GITLAB_WEBHOOK_HANDLER')
        private readonly gitlabMergeRequestHandler: IWebhookEventHandler,

        @Inject('BITBUCKET_WEBHOOK_HANDLER')
        private readonly bitbucketPullRequestHandler: IWebhookEventHandler,

        @Inject('AZURE_REPOS_WEBHOOK_HANDLER')
        private readonly azureReposPullRequestHandler: IWebhookEventHandler,

        @Inject('RULE_FILE_SYNC_WEBHOOK_HANDLER')
        private readonly ruleFileSyncHandler: IWebhookEventHandler,

        private readonly logger: PinoLoggerService,
    ) {
        // Inicializar o mapa de handlers por tipo de plataforma
        this.webhookHandlersMap = new Map<PlatformType, IWebhookEventHandler>([
            [PlatformType.GITHUB, githubPullRequestHandler],
            [PlatformType.GITLAB, gitlabMergeRequestHandler],
            [PlatformType.BITBUCKET, bitbucketPullRequestHandler],
            [PlatformType.AZURE_REPOS, azureReposPullRequestHandler],
        ]);
    }

    public async execute(params: IWebhookEventParams): Promise<void> {
        try {
            // Array to track executed handlers
            const executedHandlers: string[] = [];

            // Process primary platform handler
            const handler = this.webhookHandlersMap.get(params.platformType);
            if (handler && handler.canHandle(params)) {
                this.logger.debug({
                    message: `Processing ${params.event} with handler ${handler.constructor.name}`,
                    serviceName: ReceiveWebhookUseCase.name,
                    metadata: {
                        eventName: params.event,
                        platformType: params.platformType,
                    },
                    context: ReceiveWebhookUseCase.name,
                });

                handler.execute(params);
                executedHandlers.push(handler.constructor.name);
            }

            // Process rule file sync handler (runs independently)
    if (this.ruleFileSyncHandler.canHandle(params)) {
                this.logger.debug({
                    message: `Processing ${params.event} with rule file sync handler`,
                    serviceName: ReceiveWebhookUseCase.name,
                    metadata: {
                        eventName: params.event,
                        platformType: params.platformType,
                    },
                    context: ReceiveWebhookUseCase.name,
                });

                // Execute rule file sync in background
                setImmediate(() => {
                    this.ruleFileSyncHandler.execute(params).catch(error => {
                        this.logger.error({
                            message: 'Error in rule file sync handler',
                            context: ReceiveWebhookUseCase.name,
                            error,
                            metadata: {
                                eventName: params.event,
                                platformType: params.platformType,
                            },
                        });
                    });
                });
                
                executedHandlers.push('RuleFileSyncHandler');
            }

            // Log if no handlers were executed
            if (executedHandlers.length === 0) {
                this.logger.debug({
                    message: `No handlers found for event ${params.event}`,
                    serviceName: ReceiveWebhookUseCase.name,
                    metadata: {
                        eventName: params.event,
                        platformType: params.platformType,
                    },
                    context: ReceiveWebhookUseCase.name,
                });
            } else {
                this.logger.debug({
                    message: `Executed handlers: ${executedHandlers.join(', ')}`,
                    serviceName: ReceiveWebhookUseCase.name,
                    metadata: {
                        eventName: params.event,
                        platformType: params.platformType,
                        executedHandlers,
                    },
                    context: ReceiveWebhookUseCase.name,
                });
            }

        } catch (error) {
            this.logger.error({
                message: 'Error processing webhook',
                context: ReceiveWebhookUseCase.name,
                error: error,
                metadata: {
                    eventName: params.event,
                    platformType: params.platformType,
                },
            });
        }
    }
}
