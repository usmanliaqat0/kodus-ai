import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { SyncRepositoryRulesUseCase } from '@/core/application/use-cases/kodyRules/sync-repository-rules.use-case';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { Inject } from '@nestjs/common';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import {
    ITeamService,
    TEAM_SERVICE_TOKEN,
} from '@/core/domain/team/contracts/team.service.contract';
import { STATUS } from '@/config/types/database/status.type';
import { RuleFileSyncStatus } from '@/core/domain/parameters/types/configValue.type';

/**
 * Service responsible for automated reconciliation of repository rule files
 * 
 * This service runs periodically to:
 * - Detect drift between repository files and database rules
 * - Sync any missing or outdated rules
 * - Report reconciliation metrics
 */
@Injectable()
export class RuleFileReconciliationService {
    private readonly isReconciliationEnabled: boolean = true;
    private reconciliationStats = {
        lastRun: null as Date | null,
        totalRepositories: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        rulesProcessed: 0,
    };

    constructor(
        private readonly syncRepositoryRulesUseCase: SyncRepositoryRulesUseCase,
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,
        @Inject(TEAM_SERVICE_TOKEN)
        private readonly teamService: ITeamService,
        private readonly logger: PinoLoggerService,
    ) {}



    /**
     * Daily reconciliation for all repositories
     * Runs once a day to ensure comprehensive sync
     */
    @Cron(CronExpression.EVERY_DAY_AT_2AM)
    async performDailyReconciliation() {
        if (!this.isReconciliationEnabled) {
            return;
        }

        this.logger.log({
            message: 'Starting daily rule file reconciliation for all repositories',
            context: RuleFileReconciliationService.name,
        });

        await this.runReconciliation();
    }

    /**
     * Manual reconciliation trigger
     * Can be called by admin endpoints or monitoring systems
     */
    async performManualReconciliation(params?: {
        organizationId?: string;
        teamId?: string;
        repositoryId?: string;
    }) {
        this.logger.log({
            message: 'Starting manual rule file reconciliation',
            context: RuleFileReconciliationService.name,
            metadata: params,
        });

        await this.runReconciliation(params);
    }

    /**
     * Core reconciliation logic
     */
    private async runReconciliation(
        params?: {
            organizationId?: string;
            teamId?: string;
            repositoryId?: string;
        }
    ) {
        const startTime = new Date();
        this.reconciliationStats.lastRun = startTime;
        this.reconciliationStats.totalRepositories = 0;
        this.reconciliationStats.successfulSyncs = 0;
        this.reconciliationStats.failedSyncs = 0;
        this.reconciliationStats.rulesProcessed = 0;

        try {
            const repositories = await this.getRepositoriesToReconcile(params);

            this.logger.log({
                message: `Found ${repositories.length} repositories to reconcile`,
                context: RuleFileReconciliationService.name,
                metadata: { repositoryCount: repositories.length },
            });

            // Process repositories in batches to avoid overwhelming the system
            const batchSize = 5;
            for (let i = 0; i < repositories.length; i += batchSize) {
                const batch = repositories.slice(i, i + batchSize);
                
                await Promise.allSettled(
                    batch.map(repo => this.reconcileRepository(repo))
                );

                // Small delay between batches to reduce system load
                if (i + batchSize < repositories.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            const duration = Date.now() - startTime.getTime();
            this.logger.log({
                message: 'Rule file reconciliation completed',
                context: RuleFileReconciliationService.name,
                metadata: {
                    duration: `${duration}ms`,
                    stats: this.reconciliationStats,
                },
            });

        } catch (error) {
            this.logger.error({
                message: 'Rule file reconciliation failed',
                context: RuleFileReconciliationService.name,
                error,
                metadata: { params },
            });
        }
    }

    /**
     * Get repositories that need reconciliation
     */
    private async getRepositoriesToReconcile(
        params?: {
            organizationId?: string;
            teamId?: string;
            repositoryId?: string;
        }
    ): Promise<Array<{
        organizationId: string;
        teamId: string;
        repositoryId: string;
        repositoryName: string;
    }>> {
        const repositories = [];

        try {
            // If specific filters provided, use them
            if (params?.repositoryId) {
                // Find teams that have access to this repository
                // For now, we'll process all active teams since we don't have direct repo-to-team mapping
                const teams = await this.teamService.find({}, [STATUS.ACTIVE]);
                for (const team of teams) {
                    repositories.push({
                        organizationId: team.organization.uuid,
                        teamId: team.uuid,
                        repositoryId: params.repositoryId,
                        repositoryName: 'Unknown', // Would need to fetch from platform
                        priority: 'high' as const,
                    });
                }
                return repositories;
            }

            // Get repositories from platform configurations
            const teamsToProcess = params?.teamId 
                ? [await this.teamService.findById(params.teamId)]
                : await this.teamService.find({}, [STATUS.ACTIVE]);

            for (const team of teamsToProcess) {
                if (params?.organizationId && team.organization.uuid !== params.organizationId) {
                    continue;
                }

                // Get repository configurations for this team
                const repositoryConfigs = await this.parametersService.findByKey(
                    ParametersKey.PLATFORM_CONFIGS,
                    { 
                        organizationId: team.organization.uuid, 
                        teamId: team.uuid 
                    }
                );

                if (!repositoryConfigs) {
                    this.logger.log({
                        message: 'Platform configs not found for team',
                        context: RuleFileReconciliationService.name,
                        metadata: {
                            teamId: team.uuid,
                            organizationId: team.organization.uuid,
                        },
                    });
                    continue;
                }

                // Check if rule file sync is enabled
                const ruleFileSyncStatus = repositoryConfigs.configValue.ruleFileSyncStatus;
                
                if (!ruleFileSyncStatus || ruleFileSyncStatus === RuleFileSyncStatus.DISABLED) {
                    this.logger.log({
                        message: 'Rule file sync is disabled for team',
                        context: RuleFileReconciliationService.name,
                        metadata: {
                            teamId: team.uuid,
                            organizationId: team.organization.uuid,
                            ruleFileSyncStatus,
                        },
                    });
                    continue;
                }

                if (ruleFileSyncStatus === RuleFileSyncStatus.SYNCING) {
                    this.logger.log({
                        message: 'Rule file sync is already in progress for team',
                        context: RuleFileReconciliationService.name,
                        metadata: {
                            teamId: team.uuid,
                            organizationId: team.organization.uuid,
                        },
                    });
                    continue;
                }

                if (repositoryConfigs.configValue.repositories) {
                    for (const repo of repositoryConfigs.configValue.repositories) {
                        repositories.push({
                            organizationId: team.organization.uuid,
                            teamId: team.uuid,
                            repositoryId: repo.id,
                            repositoryName: repo.name,
                        });
                    }
                }
            }

            this.reconciliationStats.totalRepositories = repositories.length;
            return repositories;

        } catch (error) {
            this.logger.error({
                message: 'Failed to get repositories for reconciliation',
                context: RuleFileReconciliationService.name,
                error,
                metadata: { params },
            });
            return [];
        }
    }

    /**
     * Reconcile a single repository
     */
    private async reconcileRepository(
        repository: {
            organizationId: string;
            teamId: string;
            repositoryId: string;
            repositoryName: string;
        }
    ) {
        try {
            this.logger.debug({
                message: 'Starting repository reconciliation',
                context: RuleFileReconciliationService.name,
                metadata: { repositoryId: repository.repositoryId },
            });

            const result = await this.syncRepositoryRulesUseCase.executeReconciliation({
                organizationAndTeamData: {
                    organizationId: repository.organizationId,
                    teamId: repository.teamId,
                },
                repositoryId: repository.repositoryId,
                repositoryName: repository.repositoryName,
                userId: 'system-reconciliation',
            });

            this.reconciliationStats.successfulSyncs++;
            const processedCount = typeof result.processedRules === 'number' 
                ? result.processedRules 
                : (result.processedRules?.created || 0) + (result.processedRules?.updated || 0);
            this.reconciliationStats.rulesProcessed += processedCount;

            this.logger.debug({
                message: 'Repository reconciliation completed',
                context: RuleFileReconciliationService.name,
                metadata: {
                    repositoryId: repository.repositoryId,
                    result: {
                        status: result.status,
                        rulesProcessed: result.processedRules,
                        changes: result.changes?.length || 0,
                    },
                },
            });

        } catch (error) {
            this.reconciliationStats.failedSyncs++;
            
            this.logger.warn({
                message: 'Repository reconciliation failed',
                context: RuleFileReconciliationService.name,
                error,
                metadata: { repositoryId: repository.repositoryId },
            });
        }
    }



    /**
     * Get reconciliation statistics
     */
    getReconciliationStats() {
        return {
            ...this.reconciliationStats,
            isEnabled: this.isReconciliationEnabled,
        };
    }
} 