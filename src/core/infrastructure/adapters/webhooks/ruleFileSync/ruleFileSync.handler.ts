import { Injectable, Inject } from '@nestjs/common';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { 
    IWebhookEventHandler,
    IWebhookEventParams
} from '@/core/domain/platformIntegrations/interfaces/webhook-event-handler.interface';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { SyncRepositoryRulesUseCase } from '@/core/application/use-cases/kodyRules/sync-repository-rules.use-case';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { 
    RULE_FILE_PATTERNS 
} from '@/core/domain/kodyRules/interfaces/ruleFileSync.interface';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { RuleFileSyncStatus } from '@/core/domain/parameters/types/configValue.type';
import {
    IIntegrationConfigService,
    INTEGRATION_CONFIG_SERVICE_TOKEN,
} from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { IntegrationConfigKey } from '@/shared/domain/enums/Integration-config-key.enum';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';

/**
 * Webhook handler specifically for rule file changes
 * Integrates with existing webhook infrastructure to detect and sync rule file changes
 * Only processes changes from the repository's default branch
 */
@Injectable()
export class RuleFileSyncHandler implements IWebhookEventHandler {
    constructor(
        private readonly logger: PinoLoggerService,
        private readonly syncRepositoryRulesUseCase: SyncRepositoryRulesUseCase,
        private readonly codeManagementService: CodeManagementService,
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,
        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IIntegrationConfigService,
    ) {}

    /**
     * Get the correct Kodus organization and team data from repository configuration
     * This ensures we use the internal Kodus IDs, not the external provider IDs
     */
    private async getOrganizationAndTeamData(params: IWebhookEventParams): Promise<OrganizationAndTeamData | null> {
        try {
            const repositoryData = this.extractRepositoryData(params.payload);

            const configs = await this.integrationConfigService.findIntegrationConfigWithTeams(
                IntegrationConfigKey.REPOSITORIES,
                repositoryData.id,  // Repository ID from GitHub/GitLab
                params.platformType,
            );

            if (!configs?.length) {
                this.logger.warn({
                    message: 'No repository configuration found for rule sync',
                    context: RuleFileSyncHandler.name,
                    metadata: {
                        repositoryName: repositoryData.name,
                        repositoryId: repositoryData.id,
                        platformType: params.platformType,
                    },
                });
                return null;
            }

            // Return the first team configuration found (standard pattern in codebase)
            return {
                organizationId: configs[0].team.organization.uuid,  // Kodus organization ID
                teamId: configs[0].team.uuid,  // Kodus team ID
            };

        } catch (error) {
            this.logger.error({
                message: 'Failed to get organization and team data for rule sync',
                context: RuleFileSyncHandler.name,
                error: error.message,
                metadata: {
                    platformType: params.platformType,
                },
            });
            return null;
        }
    }

    /**
     * Check if this handler should process the webhook event
     * Validates push events with rule file changes (branch validation happens in execute)
     */
    canHandle(params: IWebhookEventParams): boolean {
        try {
            console.log('\n🚀 [DEBUG] ========== RuleFileSyncHandler.canHandle START ==========');
            console.log('🔍 [DEBUG] Event:', params.event);
            console.log('🔍 [DEBUG] Platform:', params.platformType);

            // Only handle push events that might contain rule file changes
            const isPushEvent = this.isPushEvent(params);
            console.log('🔍 [DEBUG] isPushEvent:', isPushEvent);
            
            if (!isPushEvent) {
                console.log('❌ [DEBUG] Not a push event - returning false');
                return false;
            }

            // Check if any rule files were changed
            const hasRuleFileChanges = this.hasRuleFileChanges(params);
            console.log('🔍 [DEBUG] hasRuleFileChanges:', hasRuleFileChanges);
            
            this.logger.debug({
                message: 'Rule file sync handler evaluation',
                context: RuleFileSyncHandler.name,
                metadata: {
                    event: params.event,
                    platform: params.platformType,
                    isPushEvent,
                    hasRuleFileChanges,
                    repository: this.extractRepositoryName(params.payload),
                },
            });

            console.log('🎯 [DEBUG] Final canHandle result:', hasRuleFileChanges);
            console.log('🚀 [DEBUG] ========== RuleFileSyncHandler.canHandle END ==========\n');
            return hasRuleFileChanges;

        } catch (error) {
            console.log('❌ [DEBUG] ERROR in canHandle:', error.message);
            console.log('❌ [DEBUG] Error stack:', error.stack);
            this.logger.warn({
                message: 'Error evaluating rule file sync handler',
                context: RuleFileSyncHandler.name,
                error,
                metadata: { event: params.event, platform: params.platformType },
            });
            return false;
        }
    }

    /**
     * Execute rule file synchronization
     * Validates default branch before processing
     */
    async execute(params: IWebhookEventParams): Promise<void> {
        try {
            const repositoryData = this.extractRepositoryData(params.payload);
            
            // ✅ Get correct Kodus organization and team data
            const organizationAndTeamData = await this.getOrganizationAndTeamData(params);
            if (!organizationAndTeamData) {
                this.logger.debug({
                    message: 'No organization/team configuration found for repository - skipping rule sync',
                    context: RuleFileSyncHandler.name,
                    metadata: {
                        repositoryName: repositoryData.name,
                        repositoryId: repositoryData.id,
                        platformType: params.platformType,
                    },
                });
                return; // Exit early - no configuration found
            }
            
            // ✅ Validate if push is to default branch
            const currentBranch = this.extractBranch(params.payload);
            const defaultBranch = await this.getRepositoryDefaultBranch(params, organizationAndTeamData);
            
            if (currentBranch !== defaultBranch) {
                this.logger.debug({
                    message: 'Ignoring rule file changes from non-default branch',
                    context: RuleFileSyncHandler.name,
                    metadata: {
                        currentBranch,
                        defaultBranch,
                        repository: repositoryData.name,
                        repositoryId: repositoryData.id,
                        event: params.event,
                        platform: params.platformType,
                        organizationId: organizationAndTeamData.organizationId,
                        teamId: organizationAndTeamData.teamId,
                    },
                });
                return; // Exit early - don't process non-default branches
            }

            // ✅ Check if rule file sync is enabled for organization (using correct Kodus org ID)
            const syncEnabled = await this.checkRuleFileSyncEnabled(organizationAndTeamData);
            if (!syncEnabled) {
                this.logger.log({
                    message: 'Rule file sync is disabled for organization',
                    context: RuleFileSyncHandler.name,
                    metadata: {
                        organizationId: organizationAndTeamData.organizationId,
                        teamId: organizationAndTeamData.teamId,
                        repository: repositoryData.name,
                        repositoryId: repositoryData.id,
                    },
                });
                return; // Exit early - rule file sync disabled
            }
            
            this.logger.log({
                message: 'Processing rule file changes from webhook (default branch)',
                context: RuleFileSyncHandler.name,
                metadata: {
                    event: params.event,
                    platform: params.platformType,
                    repository: repositoryData.name,
                    repositoryId: repositoryData.id,
                    currentBranch,
                    defaultBranch,
                    organizationId: organizationAndTeamData.organizationId,
                    teamId: organizationAndTeamData.teamId,
                },
            });

            // ✅ Execute rule file sync with correct Kodus organization and team data
            const result = await this.syncRepositoryRulesUseCase.executeWebhook({
                organizationAndTeamData, // ← USANDO DADOS CORRETOS DA KODUS
                repositoryId: repositoryData.id,
                repositoryName: repositoryData.name,
                webhookEvent: params.payload,
                branch: currentBranch,
            });

            this.logger.log({
                message: 'Rule file sync completed from webhook',
                context: RuleFileSyncHandler.name,
                metadata: {
                    repository: repositoryData.name,
                    organizationId: organizationAndTeamData.organizationId,
                    teamId: organizationAndTeamData.teamId,
                    syncStatus: result.status,
                    rulesProcessed: result.processedRules,
                    duration: result.duration,
                },
            });

        } catch (error) {
            this.logger.error({
                message: 'Failed to process rule file sync from webhook',
                context: RuleFileSyncHandler.name,
                error,
                metadata: {
                    event: params.event,
                    platform: params.platformType,
                },
            });
        }
    }

    /**
     * Check if the event is a push event
     */
    private isPushEvent(params: IWebhookEventParams): boolean {
        const { event, platformType } = params;

        switch (platformType) {
            case PlatformType.GITHUB:
                return event === 'push';
            case PlatformType.GITLAB:
                return event === 'Push Hook';
            case PlatformType.BITBUCKET:
                return event === 'repo:push';
            case PlatformType.AZURE_REPOS:
                return event === 'git.push';
            default:
                return false;
        }
    }

    /**
     * Check if the webhook contains rule file changes
     */
    private hasRuleFileChanges(params: IWebhookEventParams): boolean {
        const { payload } = params;

        try {
            // 🔍 DEBUG: Log payload structure
            console.log('🔍 [DEBUG] Payload keys:', Object.keys(payload));
            console.log('🔍 [DEBUG] Event type:', params.event);
            console.log('🔍 [DEBUG] Platform:', params.platformType);

            // Get all changed files from commits
            const changedFiles = this.extractChangedFiles(payload);
            
            // 🔍 DEBUG: Log extracted files
            console.log('🔍 [DEBUG] Extracted changedFiles:', changedFiles);
            console.log('🔍 [DEBUG] changedFiles.length:', changedFiles.length);
            
            if (changedFiles.length === 0) {
                console.log('❌ [DEBUG] No changed files found - returning false');
                return false;
            }

            // 🔍 DEBUG: Test each file against patterns
            console.log('🔍 [DEBUG] Testing files against patterns...');
            const result = changedFiles.some(filePath => {
                console.log(`\n🧪 [DEBUG] Testing file: "${filePath}"`);
                
                const fileMatches = RULE_FILE_PATTERNS.some(pattern => {
                    if (pattern.includes('*')) {
                        // Fix: Handle glob patterns correctly
                        let basePattern;
                        if (pattern.endsWith('/**/*')) {
                            // For patterns like ".cursor/rules/**/*", extract ".cursor/rules/"
                            basePattern = pattern.replace('/**/*', '/');
                        } else if (pattern.endsWith('**/*')) {
                            // For patterns like ".claude/**/*", extract ".claude/"
                            basePattern = pattern.replace('**/*', '');
                        } else {
                            // Fallback: remove all asterisks but clean up double slashes
                            basePattern = pattern.replace(/\*+/g, '').replace(/\/+/g, '/');
                        }
                        
                        const isMatch = filePath.includes(basePattern);
                        console.log(`  📝 [DEBUG] Pattern: "${pattern}" → Base: "${basePattern}" → Match: ${isMatch}`);
                        return isMatch;
                    }
                    const exactMatch = filePath === pattern;
                    const suffixMatch = filePath.endsWith('/' + pattern);
                    const isMatch = exactMatch || suffixMatch;
                    console.log(`  📝 [DEBUG] Pattern: "${pattern}" → Exact: ${exactMatch}, Suffix: ${suffixMatch} → Match: ${isMatch}`);
                    return isMatch;
                });
                
                console.log(`  ✅ [DEBUG] File "${filePath}" matches any pattern: ${fileMatches}`);
                return fileMatches;
            });

            console.log(`🎯 [DEBUG] Final hasRuleFileChanges result: ${result}`);
            return result;

        } catch (error) {
            console.log('❌ [DEBUG] ERROR in hasRuleFileChanges:', error.message);
            console.log('❌ [DEBUG] Error stack:', error.stack);
            this.logger.debug({
                message: 'Error checking for rule file changes',
                context: RuleFileSyncHandler.name,
                error,
            });
            return false;
        }
    }

    /**
     * Extract changed files from webhook payload
     */
    private extractChangedFiles(payload: any): string[] {
        const changedFiles: string[] = [];

        try {
            // 🔍 DEBUG: Log payload structure
            console.log('🔍 [DEBUG] extractChangedFiles - payload structure:');
            console.log('  - hasCommits:', !!payload.commits);
            console.log('  - hasHeadCommit:', !!payload.head_commit);
            console.log('  - hasChangesets:', !!payload.changesets);
            console.log('  - hasResource:', !!payload.resource);

            // Handle different webhook formats
            let commits = [];

            if (payload.commits) {
                // GitHub/GitLab format
                commits = payload.commits;
                console.log('🔍 [DEBUG] Using payload.commits, count:', commits.length);
            } else if (payload.head_commit) {
                // GitHub single commit
                commits = [payload.head_commit];
                console.log('🔍 [DEBUG] Using payload.head_commit');
            } else if (payload.changesets) {
                // Bitbucket format
                commits = payload.changesets || [];
                console.log('🔍 [DEBUG] Using payload.changesets, count:', commits.length);
            } else if (payload.resource?.refUpdates) {
                // Azure DevOps format
                commits = payload.resource.refUpdates || [];
                console.log('🔍 [DEBUG] Using payload.resource.refUpdates, count:', commits.length);
            }

            console.log('🔍 [DEBUG] Total commits to process:', commits.length);

            for (const commit of commits) {
                console.log('🔍 [DEBUG] Processing commit:', {
                    hasAdded: !!commit.added,
                    hasModified: !!commit.modified,
                    hasRemoved: !!commit.removed,
                    hasChanges: !!commit.changes
                });

                // Add all file changes
                if (commit.added) {
                    console.log('🔍 [DEBUG] Added files:', commit.added);
                    changedFiles.push(...commit.added);
                }
                if (commit.modified) {
                    console.log('🔍 [DEBUG] Modified files:', commit.modified);
                    changedFiles.push(...commit.modified);
                }
                if (commit.removed) {
                    console.log('🔍 [DEBUG] Removed files:', commit.removed);
                    changedFiles.push(...commit.removed);
                }
                
                // Handle different formats
                if (commit.changes) {
                    console.log('🔍 [DEBUG] Processing commit.changes, count:', commit.changes.length);
                    commit.changes.forEach((change: any) => {
                        if (change.item?.path) {
                            console.log('🔍 [DEBUG] Change item path:', change.item.path);
                            changedFiles.push(change.item.path);
                        }
                    });
                }
            }

            console.log('🔍 [DEBUG] Raw changedFiles before dedup:', changedFiles);

        } catch (error) {
            console.log('❌ [DEBUG] ERROR in extractChangedFiles:', error.message);
            console.log('❌ [DEBUG] Error stack:', error.stack);
            this.logger.debug({
                message: 'Error extracting changed files from webhook',
                context: RuleFileSyncHandler.name,
                error,
            });
        }

        const result = [...new Set(changedFiles)]; // Remove duplicates
        console.log('🔍 [DEBUG] Final changedFiles after dedup:', result);
        return result;
    }

    /**
     * Extract repository data from webhook payload
     */
    private extractRepositoryData(payload: any): {
        id: string;
        name: string;
        organizationId: string;
    } {
        // Default values
        let repositoryId = 'unknown';
        let repositoryName = 'unknown';
        let organizationId = 'unknown';

        try {
            switch (true) {
                case !!payload.repository: // GitHub/GitLab
                    repositoryId = payload.repository.id?.toString() || payload.repository.name;
                    repositoryName = payload.repository.name || payload.repository.full_name;
                    organizationId = payload.repository.owner?.id?.toString() || 
                                   payload.repository.owner?.login ||
                                   payload.repository.namespace?.id?.toString() ||
                                   payload.repository.namespace?.name;
                    break;

                case !!payload.resource?.repository: // Azure DevOps
                    repositoryId = payload.resource.repository.id;
                    repositoryName = payload.resource.repository.name;
                    organizationId = payload.resourceContainers?.account?.id ||
                                   payload.resourceContainers?.project?.id;
                    break;

                default:
                    this.logger.warn({
                        message: 'Unknown webhook payload format for repository extraction',
                        context: RuleFileSyncHandler.name,
                        metadata: { payload: JSON.stringify(payload).substring(0, 200) },
                    });
            }

        } catch (error) {
            this.logger.warn({
                message: 'Error extracting repository data from webhook',
                context: RuleFileSyncHandler.name,
                error,
            });
        }

        return {
            id: repositoryId,
            name: repositoryName,
            organizationId,
        };
    }

    /**
     * Extract repository name from payload
     */
    private extractRepositoryName(payload: any): string {
        return payload?.repository?.name || 
               payload?.resource?.repository?.name || 
               'unknown';
    }

    /**
     * Extract branch from webhook payload
     */
    private extractBranch(payload: any): string {
        if (payload.ref) {
            // GitHub/GitLab: refs/heads/branch-name
            return payload.ref.replace('refs/heads/', '');
        }
        
        if (payload.resource?.refUpdates?.[0]?.name) {
            // Azure DevOps: refs/heads/branch-name
            return payload.resource.refUpdates[0].name.replace('refs/heads/', '');
        }
        
        if (payload.push?.changes?.[0]?.new?.name) {
            // Bitbucket
            return payload.push.changes[0].new.name;
        }
        
        return 'main'; // Default fallback
    }

    /**
     * Check if rule file sync is enabled for the specific team
     * Returns true if the team has rule file sync enabled
     */
    private async checkRuleFileSyncEnabled(organizationAndTeamData: OrganizationAndTeamData): Promise<boolean> {
        try {
            // Get platform config for this specific team
            const config = await this.parametersService.findByKey(
                ParametersKey.PLATFORM_CONFIGS,
                { 
                    organizationId: organizationAndTeamData.organizationId,
                    teamId: organizationAndTeamData.teamId 
                }
            );

            if (!config) {
                this.logger.log({
                    message: 'No platform config found for team',
                    context: RuleFileSyncHandler.name,
                    metadata: { 
                        organizationId: organizationAndTeamData.organizationId,
                        teamId: organizationAndTeamData.teamId 
                    },
                });
                return false; // Default to disabled if no config found
            }

            const ruleFileSyncStatus = config.configValue?.ruleFileSyncStatus;
            const isEnabled = ruleFileSyncStatus === RuleFileSyncStatus.ENABLED;

            this.logger.debug({
                message: 'Rule file sync status checked for team',
                context: RuleFileSyncHandler.name,
                metadata: { 
                    organizationId: organizationAndTeamData.organizationId,
                    teamId: organizationAndTeamData.teamId,
                    ruleFileSyncStatus,
                    isEnabled
                },
            });

            return isEnabled;

        } catch (error) {
            this.logger.error({
                message: 'Failed to check rule file sync configuration for team',
                context: RuleFileSyncHandler.name,
                error,
                metadata: { 
                    organizationId: organizationAndTeamData.organizationId,
                    teamId: organizationAndTeamData.teamId 
                },
            });
            // Return true on error to avoid blocking sync (fail open)
            return true;
        }
    }

    /**
     * Get the default branch of the repository using correct Kodus organization data
     */
    private async getRepositoryDefaultBranch(
        params: IWebhookEventParams, 
        organizationAndTeamData: OrganizationAndTeamData
    ): Promise<string> {
        try {
            const repositoryData = this.extractRepositoryData(params.payload);
            
            const defaultBranch = await this.codeManagementService.getDefaultBranch({
                organizationAndTeamData, // ← Using correct Kodus organization data
                repository: {
                    name: repositoryData.name,
                    id: repositoryData.id
                }
            }, params.platformType);
            
            return defaultBranch || 'main'; // fallback
        } catch (error) {
            this.logger.warn({
                message: 'Failed to get default branch, falling back to main',
                context: RuleFileSyncHandler.name,
                error,
                metadata: { 
                    event: params.event,
                    platform: params.platformType,
                    organizationId: organizationAndTeamData.organizationId,
                    teamId: organizationAndTeamData.teamId,
                },
            });
            return 'main';
        }
    }
} 