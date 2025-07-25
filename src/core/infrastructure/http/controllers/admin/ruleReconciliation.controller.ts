import { Controller, Post, Get, Body } from '@nestjs/common';
import { RuleFileReconciliationService } from '@/ee/kodyRules/services/ruleFileReconciliation.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';

/**
 * Administrative controller for rule file reconciliation
 * Provides endpoints for manual reconciliation and monitoring
 */
@Controller('admin/rule-reconciliation')
export class RuleReconciliationController {
    constructor(
        private readonly ruleFileReconciliationService: RuleFileReconciliationService,
        private readonly logger: PinoLoggerService,
    ) {}

    /**
     * Trigger manual reconciliation
     */
    @Post('trigger')
    async triggerReconciliation(
        @Body() body: {
            organizationId?: string;
            teamId?: string;
            repositoryId?: string;
        }
    ) {
        try {
            this.logger.log({
                message: 'Manual reconciliation triggered via admin endpoint',
                context: RuleReconciliationController.name,
                metadata: body,
            });

            // Execute reconciliation in background
            setImmediate(() => {
                this.ruleFileReconciliationService
                    .performManualReconciliation(body)
                    .catch(error => {
                        this.logger.error({
                            message: 'Manual reconciliation failed',
                            context: RuleReconciliationController.name,
                            error,
                            metadata: body,
                        });
                    });
            });

            return {
                success: true,
                message: 'Reconciliation triggered successfully',
                triggeredAt: new Date().toISOString(),
            };

        } catch (error) {
            this.logger.error({
                message: 'Failed to trigger reconciliation',
                context: RuleReconciliationController.name,
                error,
                metadata: body,
            });

            return {
                success: false,
                message: 'Failed to trigger reconciliation',
                error: error.message,
            };
        }
    }

    /**
     * Get reconciliation statistics
     */
    @Get('stats')
    async getReconciliationStats() {
        try {
            const stats = this.ruleFileReconciliationService.getReconciliationStats();
            
            // Calculate success rate
            const totalAttempts = stats.successfulSyncs + stats.failedSyncs;
            const successRate = totalAttempts > 0 
                ? Math.round((stats.successfulSyncs / totalAttempts) * 100) 
                : 0;

            return {
                ...stats,
                successRate,
                retrievedAt: new Date().toISOString(),
            };

        } catch (error) {
            this.logger.error({
                message: 'Failed to retrieve reconciliation stats',
                context: RuleReconciliationController.name,
                error,
            });

            return {
                error: 'Failed to retrieve statistics',
                message: error.message,
                retrievedAt: new Date().toISOString(),
            };
        }
    }

    /**
     * Health check for reconciliation service
     */
    @Get('health')
    async checkHealth() {
        try {
            const stats = this.ruleFileReconciliationService.getReconciliationStats();
            
            let status = 'healthy';
            let timeSinceLastRun = 'Never';
            
            if (stats.lastRun) {
                const timeDiff = Date.now() - stats.lastRun.getTime();
                const hoursSinceLastRun = timeDiff / (1000 * 60 * 60);
                
                timeSinceLastRun = `${Math.round(hoursSinceLastRun * 10) / 10} hours ago`;
                
                // Warning if no reconciliation in last 25 hours (should run every hour + daily)
                if (hoursSinceLastRun > 25) {
                    status = 'warning';
                }
                
                // Error if no reconciliation in last 48 hours
                if (hoursSinceLastRun > 48) {
                    status = 'error';
                }
            } else if (stats.isEnabled) {
                status = 'warning'; // Enabled but never ran
            }

            return {
                status,
                lastRun: stats.lastRun?.toISOString() || null,
                timeSinceLastRun,
                isEnabled: stats.isEnabled,
                checkedAt: new Date().toISOString(),
            };

        } catch (error) {
            this.logger.error({
                message: 'Health check failed',
                context: RuleReconciliationController.name,
                error,
            });

            return {
                status: 'error',
                error: error.message,
                checkedAt: new Date().toISOString(),
            };
        }
    }
} 