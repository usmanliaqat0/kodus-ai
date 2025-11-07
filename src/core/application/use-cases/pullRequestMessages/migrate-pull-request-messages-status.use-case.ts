import { Inject, Injectable } from '@nestjs/common';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import {
    PULL_REQUEST_MESSAGES_REPOSITORY_TOKEN,
    IPullRequestMessagesRepository,
} from '@/core/domain/pullRequestMessages/contracts/pullRequestMessages.repository.contract';
import { PullRequestMessageStatus } from '@/config/types/general/pullRequestMessages.type';
import { IPullRequestMessages } from '@/core/domain/pullRequestMessages/interfaces/pullRequestMessages.interface';

@Injectable()
export class MigratePullRequestMessagesStatusUseCase {
    constructor(
        private readonly logger: PinoLoggerService,

        @Inject(PULL_REQUEST_MESSAGES_REPOSITORY_TOKEN)
        private readonly pullRequestMessagesRepository: IPullRequestMessagesRepository,
    ) {}

    async execute(): Promise<{ totalMigrated: number; errors: number }> {
        try {
            this.logger.log({
                message: 'Starting pull request messages status migration',
                context: this.execute.name,
                serviceName: MigratePullRequestMessagesStatusUseCase.name,
            });

            const allMessages = await this.pullRequestMessagesRepository.find();

            let totalMigrated = 0;
            let errors = 0;

            for (const messageConfig of allMessages) {
                try {
                    let needsUpdate = false;
                    const updatedConfig = {
                        uuid: messageConfig.uuid,
                        organizationId: messageConfig.organizationId,
                        configLevel: messageConfig.configLevel,
                        repositoryId: messageConfig.repositoryId,
                        directoryId: messageConfig.directoryId,
                        startReviewMessage: messageConfig.startReviewMessage,
                        endReviewMessage: messageConfig.endReviewMessage,
                        globalSettings: messageConfig.globalSettings,
                    };

                    if (
                        messageConfig.startReviewMessage?.status ===
                        PullRequestMessageStatus.ACTIVE
                    ) {
                        updatedConfig.startReviewMessage = {
                            ...messageConfig.startReviewMessage,
                            status: PullRequestMessageStatus.EVERY_PUSH,
                        };
                        needsUpdate = true;
                    }

                    if (
                        messageConfig.startReviewMessage?.status ===
                        PullRequestMessageStatus.INACTIVE
                    ) {
                        updatedConfig.startReviewMessage = {
                            ...messageConfig.startReviewMessage,
                            status: PullRequestMessageStatus.OFF,
                        };
                        needsUpdate = true;
                    }

                    if (
                        messageConfig.endReviewMessage?.status ===
                        PullRequestMessageStatus.ACTIVE
                    ) {
                        updatedConfig.endReviewMessage = {
                            ...messageConfig.endReviewMessage,
                            status: PullRequestMessageStatus.EVERY_PUSH,
                        };
                        needsUpdate = true;
                    }

                    if (
                        messageConfig.endReviewMessage?.status ===
                        PullRequestMessageStatus.INACTIVE
                    ) {
                        updatedConfig.endReviewMessage = {
                            ...messageConfig.endReviewMessage,
                            status: PullRequestMessageStatus.OFF,
                        };
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        await this.pullRequestMessagesRepository.update(
                            updatedConfig,
                        );

                        totalMigrated++;

                        this.logger.log({
                            message: `Migrated message config ${messageConfig.uuid}`,
                            context: this.execute.name,
                            serviceName:
                                MigratePullRequestMessagesStatusUseCase.name,
                            metadata: {
                                configId: messageConfig.uuid,
                                organizationId: messageConfig.organizationId,
                                configLevel: messageConfig.configLevel,
                                startStatus:
                                    messageConfig.startReviewMessage?.status,
                                endStatus:
                                    messageConfig.endReviewMessage?.status,
                                newStartStatus:
                                    updatedConfig.startReviewMessage?.status,
                                newEndStatus:
                                    updatedConfig.endReviewMessage?.status,
                            },
                        });
                    }
                } catch (error) {
                    errors++;
                    this.logger.error({
                        message: `Error migrating message config ${messageConfig.uuid}`,
                        error,
                        context: this.execute.name,
                        serviceName:
                            MigratePullRequestMessagesStatusUseCase.name,
                        metadata: {
                            configId: messageConfig.uuid,
                            organizationId: messageConfig.organizationId,
                        },
                    });
                }
            }

            this.logger.log({
                message: 'Pull request messages status migration completed',
                context: this.execute.name,
                serviceName: MigratePullRequestMessagesStatusUseCase.name,
                metadata: {
                    totalConfigs: allMessages.length,
                    totalMigrated,
                    errors,
                },
            });

            return { totalMigrated, errors };
        } catch (error) {
            this.logger.error({
                message: 'Error during pull request messages migration',
                error,
                context: this.execute.name,
                serviceName: MigratePullRequestMessagesStatusUseCase.name,
            });

            throw error;
        }
    }
}

