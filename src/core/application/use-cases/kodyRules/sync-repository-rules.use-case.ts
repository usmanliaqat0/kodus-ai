import { Injectable, Inject } from '@nestjs/common';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { 
    IRuleFileSyncService,
    RuleFileSyncOrigin,
    IRuleFileSyncContext,
    IRuleFileSyncResult,
    RULE_FILE_SYNC_SERVICE_TOKEN
} from '@/core/domain/kodyRules/interfaces/ruleFileSync.interface';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';

/**
 * Use case for synchronizing repository rule files with Kody Rules
 * 
 * This use case handles:
 * - Initial sync during repository onboarding
 * - Manual sync triggered by users
 * - Webhook-triggered sync for file changes
 * - Reconciliation to detect and fix drift
 */
@Injectable()
export class SyncRepositoryRulesUseCase implements IUseCase {
    constructor(
        @Inject(RULE_FILE_SYNC_SERVICE_TOKEN)
        private readonly ruleFileSyncService: IRuleFileSyncService,
        private readonly logger: PinoLoggerService,
    ) {}

    async execute(params: any): Promise<any> {
        throw new Error('Use specific execute methods: executeOnboarding, executeWebhook, executeReconciliation, executeGetPullRequestRules');
    }

    /**
     * Sync repository rules during onboarding
     */
    async executeOnboarding(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repositoryId: string;
        repositoryName: string;
        branch?: string;
    }): Promise<IRuleFileSyncResult> {
        this.logger.log({
            message: 'Starting repository rules onboarding sync',
            context: SyncRepositoryRulesUseCase.name,
            metadata: { params },
        });

        const context: IRuleFileSyncContext = {
            organizationId: params.organizationAndTeamData.organizationId,
            teamId: params.organizationAndTeamData.teamId, // ← Add teamId
            repositoryId: params.repositoryId,
            repositoryName: params.repositoryName,
            branch: params.branch,
            origin: RuleFileSyncOrigin.ONBOARDING,
            triggerData: {
                userId: 'system', // Could be passed from request context
            },
        };

        try {
            const result = await this.ruleFileSyncService.syncOnboarding(context);

            this.logger.log({
                message: 'Repository rules onboarding sync completed',
                context: SyncRepositoryRulesUseCase.name,
                metadata: { 
                    repositoryId: params.repositoryId,
                    result: {
                        status: result.status,
                        rulesProcessed: result.processedRules,
                        duration: result.duration,
                    }
                },
            });

            return result;

        } catch (error) {
            this.logger.error({
                message: 'Repository rules onboarding sync failed',
                context: SyncRepositoryRulesUseCase.name,
                error,
                metadata: { params },
            });
            throw error;
        }
    }

    /**
     * Process webhook event for rule file changes
     */
    async executeWebhook(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repositoryId: string;
        repositoryName: string;
        webhookEvent: any;
        branch?: string;
        pullRequestNumber?: number;
    }): Promise<IRuleFileSyncResult> {
        this.logger.log({
            message: 'Processing webhook for repository rule changes',
            context: SyncRepositoryRulesUseCase.name,
            metadata: { 
                repositoryId: params.repositoryId,
                eventType: params.webhookEvent?.type,
                pullRequestNumber: params.pullRequestNumber,
            },
        });

        const context: IRuleFileSyncContext = {
            organizationId: params.organizationAndTeamData.organizationId,
            teamId: params.organizationAndTeamData.teamId, // ← Add teamId
            repositoryId: params.repositoryId,
            repositoryName: params.repositoryName,
            branch: params.branch,
            pullRequestNumber: params.pullRequestNumber,
            origin: RuleFileSyncOrigin.WEBHOOK,
            triggerData: {
                webhookEvent: params.webhookEvent,
            },
        };

        try {
            const result = await this.ruleFileSyncService.processWebhookEvent(
                params.webhookEvent,
                context
            );

            this.logger.log({
                message: 'Webhook rule sync completed',
                context: SyncRepositoryRulesUseCase.name,
                metadata: { 
                    repositoryId: params.repositoryId,
                    result: {
                        status: result.status,
                        rulesProcessed: result.processedRules,
                        changesCount: result.changes.length,
                        duration: result.duration,
                    }
                },
            });

            return result;

        } catch (error) {
            this.logger.error({
                message: 'Webhook rule sync failed',
                context: SyncRepositoryRulesUseCase.name,
                error,
                metadata: { params },
            });
            throw error;
        }
    }

    /**
     * Perform manual reconciliation
     */
    async executeReconciliation(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repositoryId: string;
        repositoryName: string;
        branch?: string;
        userId?: string;
    }): Promise<IRuleFileSyncResult> {
        this.logger.log({
            message: 'Starting manual repository rules reconciliation',
            context: SyncRepositoryRulesUseCase.name,
            metadata: { params },
        });

        const context: IRuleFileSyncContext = {
            organizationId: params.organizationAndTeamData.organizationId,
            teamId: params.organizationAndTeamData.teamId, // ← Add teamId
            repositoryId: params.repositoryId,
            repositoryName: params.repositoryName,
            branch: params.branch,
            origin: RuleFileSyncOrigin.RECONCILIATION,
            triggerData: {
                userId: params.userId,
            },
        };

        try {
            const result = await this.ruleFileSyncService.reconcile(context);

            this.logger.log({
                message: 'Repository rules reconciliation completed',
                context: SyncRepositoryRulesUseCase.name,
                metadata: { 
                    repositoryId: params.repositoryId,
                    result: {
                        status: result.status,
                        rulesProcessed: result.processedRules,
                        changesCount: result.changes.length,
                        duration: result.duration,
                    }
                },
            });

            return result;

        } catch (error) {
            this.logger.error({
                message: 'Repository rules reconciliation failed',
                context: SyncRepositoryRulesUseCase.name,
                error,
                metadata: { params },
            });
            throw error;
        }
    }



    /**
     * Get sync history for a repository
     */
    async executeGetSyncHistory(params: {
        organizationId: string;
        repositoryId: string;
        limit?: number;
    }): Promise<IRuleFileSyncResult[]> {
        this.logger.debug({
            message: 'Getting sync history for repository',
            context: SyncRepositoryRulesUseCase.name,
            metadata: { params },
        });

        try {
            const history = await this.ruleFileSyncService.getSyncHistory(
                params.organizationId,
                params.repositoryId,
                params.limit
            );

            return history;

        } catch (error) {
            this.logger.error({
                message: 'Failed to get sync history',
                context: SyncRepositoryRulesUseCase.name,
                error,
                metadata: { params },
            });
            
            return [];
        }
    }
} 