import { Injectable, Inject } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
    IRuleFileSyncService,
    IRuleFileSyncContext,
    IRuleFileSyncResult,
    IRuleFileChange,
    RuleFileChangeType,
    RuleFileSyncOrigin,
    RuleFileSyncStatus,
    IParsedRuleContent,
    RULE_FILE_PATTERNS,
} from '@/core/domain/kodyRules/interfaces/ruleFileSync.interface';
import {
    IKodyRulesService,
    KODY_RULES_SERVICE_TOKEN,
} from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { LLMRuleExtractionService } from './llmRuleExtraction.service';
import {
    KodyRulesOrigin,
    KodyRulesStatus,
    IKodyRule,
    KodyRulesScope,
} from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import { KodyRuleSeverity } from '@/core/infrastructure/http/dtos/create-kody-rule.dto';
import { minimatch } from 'minimatch';

/**
 * Main service that orchestrates the rule file synchronization process using LLM
 *
 * This service coordinates:
 * - Detection of rule file changes in repositories
 * - LLM-based parsing of different rule file formats
 * - Synchronization with Kody Rules database
 * - Conflict resolution
 * - PR context rule application
 */
@Injectable()
export class RuleFileSyncService implements IRuleFileSyncService {
    constructor(
        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,
        private readonly codeManagementService: CodeManagementService,
        private readonly llmRuleExtractionService: LLMRuleExtractionService,
        private readonly logger: PinoLoggerService,
    ) {}

    /**
     * Sync rules from repository files during onboarding
     */
    async syncOnboarding(
        context: IRuleFileSyncContext,
    ): Promise<IRuleFileSyncResult> {
        const syncId = uuidv4();
        const startTime = Date.now();

        this.logger.log({
            message: 'Starting onboarding rule file sync with LLM',
            context: RuleFileSyncService.name,
            metadata: { syncId, context },
        });

        try {
            // Get default branch if not provided in context
            const defaultBranch =
                context.branch ||
                (await this.getRepositoryDefaultBranch(
                    context.organizationId,
                    context.repositoryId,
                    context.repositoryName,
                    context.teamId,
                ));

            // Update context with default branch for consistency
            const contextWithBranch = { ...context, branch: defaultBranch };

            // Get all rule files from repository
            const ruleFiles =
                await this.getAllRuleFilesFromRepository(contextWithBranch);

            if (ruleFiles.length === 0) {
                this.logger.log({
                    message: 'No rule files found in repository',
                    context: RuleFileSyncService.name,
                    metadata: { syncId, repositoryId: context.repositoryId },
                });

                return {
                    syncId,
                    context: contextWithBranch,
                    status: RuleFileSyncStatus.COMPLETED,
                    changes: [],
                    processedRules: {
                        created: 0,
                        updated: 0,
                        deleted: 0,
                        skipped: 0,
                    },
                    duration: Date.now() - startTime,
                    startedAt: new Date(startTime),
                    completedAt: new Date(),
                };
            }

            // Detect repository context for better LLM analysis
            const repositoryContext =
                await this.detectRepositoryContext(context);

            // Parse all rule files using LLM
            const extractionResults =
                await this.llmRuleExtractionService.extractRulesFromMultipleFiles(
                    ruleFiles,
                    repositoryContext,
                );

            // Use consolidated rules (already deduplicated)
            const allParsedRules = extractionResults.consolidatedRules;

            this.logger.log({
                message: 'LLM parsing completed for onboarding',
                context: RuleFileSyncService.name,
                metadata: {
                    syncId,
                    filesProcessed: extractionResults.individualResults.length,
                    rulesExtracted: allParsedRules.length,
                    deduplicationSummary:
                        extractionResults.deduplicationSummary,
                },
            });

            // Convert to Kody Rules and sync
            const syncResult = await this.syncRulesToDatabase(
                allParsedRules,
                contextWithBranch,
                'onboarding',
            );

            const result: IRuleFileSyncResult = {
                syncId,
                context: contextWithBranch,
                status: RuleFileSyncStatus.COMPLETED,
                changes: ruleFiles.map((file) => ({
                    filePath: file.path,
                    changeType: RuleFileChangeType.CREATED,
                    content: file.content,
                    commitSha: 'onboarding',
                    timestamp: new Date(),
                    author: { name: 'System', email: 'system@kodus.ai' },
                    repositoryId: contextWithBranch.repositoryId,
                    branch: contextWithBranch.branch,
                })),
                processedRules: syncResult,
                duration: Date.now() - startTime,
                startedAt: new Date(startTime),
                completedAt: new Date(),
            };

            this.logger.log({
                message: 'Onboarding rule file sync completed with LLM',
                context: RuleFileSyncService.name,
                metadata: {
                    syncId,
                    result: {
                        status: result.status,
                        rulesProcessed: result.processedRules,
                        filesProcessed: ruleFiles.length,
                    },
                },
            });

            return result;
        } catch (error) {
            this.logger.error({
                message: 'Onboarding rule file sync failed',
                context: RuleFileSyncService.name,
                error,
                metadata: { syncId, context },
            });

            return {
                syncId,
                context,
                status: RuleFileSyncStatus.FAILED,
                changes: [],
                processedRules: {
                    created: 0,
                    updated: 0,
                    deleted: 0,
                    skipped: 0,
                },
                errors: [{ filePath: '', error: error.message, type: 'sync' }],
                duration: Date.now() - startTime,
                startedAt: new Date(startTime),
                completedAt: new Date(),
            };
        }
    }

    /**
     * Process webhook event for rule file changes
     */
    async processWebhookEvent(
        webhookEvent: any,
        context: IRuleFileSyncContext,
    ): Promise<IRuleFileSyncResult> {
        const syncId = uuidv4();
        const startTime = Date.now();

        this.logger.log({
            message: 'Processing webhook event for rule file changes with LLM',
            context: RuleFileSyncService.name,
            metadata: {
                syncId,
                context,
                webhookEvent: { type: webhookEvent.type },
            },
        });

        try {
            // Get default branch for webhook context
            const defaultBranch = await this.getRepositoryDefaultBranch(
                context.organizationId,
                context.repositoryId,
                context.repositoryName,
                context.teamId,
            );

            // Extract file changes from webhook
            const ruleFileChanges = this.extractRuleFileChangesFromWebhook(
                webhookEvent,
                defaultBranch,
            );

            if (ruleFileChanges.length === 0) {
                this.logger.debug({
                    message: 'No rule file changes detected in webhook',
                    context: RuleFileSyncService.name,
                    metadata: { syncId },
                });

                return {
                    syncId,
                    context,
                    status: RuleFileSyncStatus.SKIPPED,
                    changes: [],
                    processedRules: {
                        created: 0,
                        updated: 0,
                        deleted: 0,
                        skipped: 0,
                    },
                    duration: Date.now() - startTime,
                    startedAt: new Date(startTime),
                    completedAt: new Date(),
                };
            }

            // Detect repository context
            const repositoryContext =
                await this.detectRepositoryContext(context);

            // Primeiro, tratar renomeações de arquivos de regras
            for (const change of ruleFileChanges) {
                if (change.changeType === RuleFileChangeType.RENAMED && change.previousFilePath) {
                    await this.processRuleFileRename(change.previousFilePath, change.filePath, context);
                }
            }

            // Process each rule file change using LLM (exceto DELETED e RENAMED)
            const processResults = await Promise.all(
                ruleFileChanges
                    .filter(
                        (change) =>
                            change.changeType !== RuleFileChangeType.DELETED &&
                            change.changeType !== RuleFileChangeType.RENAMED,
                    )
                    .map((change) =>
                        this.processRuleFileChangeWithLLM(
                            change,
                            context,
                            repositoryContext,
                            defaultBranch,
                        ),
                    ),
            );

            // Handle deletions separately
            const deletionResults = await Promise.all(
                ruleFileChanges
                    .filter(
                        (change) =>
                            change.changeType === RuleFileChangeType.DELETED,
                    )
                    .map((change) =>
                        this.processRuleFileDeletion(change, context),
                    ),
            );

            // Aggregate results
            const allResults = [...processResults, ...deletionResults];
            const totalProcessed = allResults.reduce(
                (acc, result) => ({
                    created: acc.created + result.created,
                    updated: acc.updated + result.updated,
                    deleted: acc.deleted + result.deleted,
                    skipped: acc.skipped + result.skipped,
                }),
                { created: 0, updated: 0, deleted: 0, skipped: 0 },
            );

            const errors = allResults
                .filter((result) => result.errors?.length > 0)
                .flatMap((result) => result.errors);

            const result: IRuleFileSyncResult = {
                syncId,
                context,
                status:
                    errors.length > 0
                        ? RuleFileSyncStatus.FAILED
                        : RuleFileSyncStatus.COMPLETED,
                changes: ruleFileChanges,
                processedRules: totalProcessed,
                errors: errors.length > 0 ? errors : undefined,
                duration: Date.now() - startTime,
                startedAt: new Date(startTime),
                completedAt: new Date(),
            };

            this.logger.log({
                message: 'Webhook rule file sync completed with LLM',
                context: RuleFileSyncService.name,
                metadata: {
                    syncId,
                    result: {
                        status: result.status,
                        changesProcessed: ruleFileChanges.length,
                        rulesProcessed: totalProcessed,
                    },
                },
            });

            return result;
        } catch (error) {
            this.logger.error({
                message: 'Webhook rule file sync failed',
                context: RuleFileSyncService.name,
                error,
                metadata: { syncId, context },
            });

            return {
                syncId,
                context,
                status: RuleFileSyncStatus.FAILED,
                changes: [],
                processedRules: {
                    created: 0,
                    updated: 0,
                    deleted: 0,
                    skipped: 0,
                },
                errors: [{ filePath: '', error: error.message, type: 'sync' }],
                duration: Date.now() - startTime,
                startedAt: new Date(startTime),
                completedAt: new Date(),
            };
        }
    }

    // Placeholder methods (implement based on existing codebase patterns)
    async reconcile(): Promise<IRuleFileSyncResult> {
        throw new Error('Method not implemented.');
    }

    async getSyncHistory(): Promise<IRuleFileSyncResult[]> {
        throw new Error('Method not implemented.');
    }

    // Private helper methods

    /**
     * Get the default branch for a repository
     */
    private async getRepositoryDefaultBranch(
        organizationId: string,
        repositoryId: string,
        repositoryName: string,
        teamId?: string, // ← Add teamId parameter
    ): Promise<string> {
        try {
            const defaultBranch =
                await this.codeManagementService.getDefaultBranch({
                    organizationAndTeamData: {
                        organizationId: organizationId,
                        teamId: teamId, // ← Use teamId parameter
                    },
                    repository: { id: repositoryId, name: repositoryName },
                });

            return defaultBranch || 'main'; // Fallback to 'main' if not found
        } catch (error) {
            this.logger.warn({
                message: 'Failed to get default branch, using main as fallback',
                context: RuleFileSyncService.name,
                error,
                metadata: { organizationId, repositoryId },
            });
            return 'main';
        }
    }

    private async getAllRuleFilesFromRepository(
        context: IRuleFileSyncContext,
    ): Promise<Array<{ path: string; content: string }>> {
        try {
            this.logger.debug({
                message: 'Scanning repository for rule files',
                context: RuleFileSyncService.name,
                metadata: {
                    repositoryId: context.repositoryId,
                    branch: context.branch,
                },
            });

            // Convert RULE_FILE_PATTERNS to file patterns for the API
            const filePatterns = RULE_FILE_PATTERNS.map((pattern) => {
                // Convert our patterns to glob patterns
                if (pattern.includes('**/*')) {
                    return pattern;
                } else if (pattern.includes('*')) {
                    return pattern;
                } else {
                    return pattern; // Exact file names
                }
            });

            // Get default branch if not provided in context
            const defaultBranch =
                context.branch ||
                (await this.getRepositoryDefaultBranch(
                    context.organizationId,
                    context.repositoryId,
                    context.repositoryName,
                    context.teamId,
                ));

            // Get all files matching rule patterns
            const allFiles =
                await this.codeManagementService.getRepositoryAllFiles({
                    repository: context.repositoryName,
                    organizationName: context.organizationId,
                    branch: defaultBranch,
                    organizationAndTeamData: {
                        organizationId: context.organizationId,
                        teamId: context.teamId,
                    },
                    filePatterns,
                    maxFiles: 100, // Limit to avoid performance issues
                });

            if (!allFiles || allFiles.length === 0) {
                this.logger.debug({
                    message: 'No rule files found in repository',
                    context: RuleFileSyncService.name,
                    metadata: { repositoryId: context.repositoryId },
                });
                return [];
            }

            // Filter files that match our rule patterns and get their content
            const ruleFiles: Array<{ path: string; content: string }> = [];

            for (const file of allFiles) {
                // Double-check if file matches our patterns
                const isRuleFile = RULE_FILE_PATTERNS.some((pattern) => {
                    if (pattern.includes('*')) {
                        // Fix: Handle glob patterns correctly
                        let basePattern;
                        if (pattern.endsWith('/**/*')) {
                            basePattern = pattern.replace('/**/*', '/');
                        } else if (pattern.endsWith('**/*')) {
                            basePattern = pattern.replace('**/*', '');
                        } else {
                            basePattern = pattern
                                .replace(/\*+/g, '')
                                .replace(/\/+/g, '/');
                        }
                        return file.path?.includes(basePattern);
                    }
                    return (
                        file.path === pattern ||
                        file.path?.endsWith('/' + pattern)
                    );
                });

                if (isRuleFile && file.type === 'file') {
                    try {
                        // Get file content
                        const fileContent =
                            await this.codeManagementService.getRepositoryContentFile(
                                {
                                    organizationAndTeamData: {
                                        organizationId: context.organizationId,
                                        teamId: context.teamId, // ← Add teamId
                                    },
                                    repository: {
                                        name: context.repositoryName,
                                        id: context.repositoryId,
                                    },
                                    file: { path: file.path },
                                    pullRequest: null, // Get from main branch
                                },
                            );

                        if (fileContent?.content) {
                            ruleFiles.push({
                                path: file.path,
                                content: fileContent.content,
                            });
                        }
                    } catch (error) {
                        this.logger.warn({
                            message: 'Failed to get content for rule file',
                            context: RuleFileSyncService.name,
                            error,
                            metadata: {
                                filePath: file.path,
                                repositoryId: context.repositoryId,
                            },
                        });
                    }
                }
            }

            this.logger.log({
                message: 'Found rule files in repository',
                context: RuleFileSyncService.name,
                metadata: {
                    repositoryId: context.repositoryId,
                    totalFiles: allFiles.length,
                    ruleFiles: ruleFiles.length,
                    ruleFilePaths: ruleFiles.map((f) => f.path),
                },
            });

            return ruleFiles;
        } catch (error) {
            this.logger.error({
                message: 'Failed to scan repository for rule files',
                context: RuleFileSyncService.name,
                error,
                metadata: { repositoryId: context.repositoryId },
            });
            return [];
        }
    }

    private extractRuleFileChangesFromWebhook(
        webhookEvent: any,
        defaultBranch: string,
    ): IRuleFileChange[] {
        try {
            this.logger.debug({
                message: 'Extracting rule file changes from webhook',
                context: RuleFileSyncService.name,
                metadata: {
                    eventType: webhookEvent.action || webhookEvent.event_type,
                    repository: webhookEvent.repository?.name,
                },
            });

            const ruleFileChanges: IRuleFileChange[] = [];
            const processedFiles = new Set<string>(); // ← Track processed files to avoid duplicates

            // Handle different webhook event types (GitHub, GitLab, etc.)
            let commits = [];

            if (webhookEvent.commits) {
                // GitHub push event
                commits = webhookEvent.commits;
            } else if (webhookEvent.head_commit) {
                // GitHub push event (single commit)
                commits = [webhookEvent.head_commit];
            } else if (webhookEvent.object_attributes?.commits) {
                // GitLab push event
                commits = webhookEvent.object_attributes.commits;
            }

            this.logger.debug({
                message: '🔍 [DEBUG] Processing commits for rule files',
                context: RuleFileSyncService.name,
                metadata: {
                    commitsCount: commits.length,
                    commitIds: commits.map((c) => c.id || c.sha),
                },
            });

            // Extract file changes from commits
            for (const commit of commits) {
                const allChangedFiles = [
                    ...(commit.added || []),
                    ...(commit.modified || []),
                    ...(commit.removed || []),
                ];

                this.logger.debug({
                    message: '🔍 [DEBUG] Processing commit files',
                    context: RuleFileSyncService.name,
                    metadata: {
                        commitId: commit.id || commit.sha,
                        allChangedFiles,
                        added: commit.added || [],
                        modified: commit.modified || [],
                        removed: commit.removed || [],
                    },
                });

                for (const filePath of allChangedFiles) {
                    // ✅ Skip if already processed to avoid duplicates
                    if (processedFiles.has(filePath)) {
                        this.logger.debug({
                            message:
                                '⚠️ [DEBUG] File already processed, skipping duplicate',
                            context: RuleFileSyncService.name,
                            metadata: {
                                filePath,
                                commitId: commit.id || commit.sha,
                            },
                        });
                        continue;
                    }

                    // Check if file matches rule patterns
                    const isRuleFile = RULE_FILE_PATTERNS.some((pattern) => {
                        if (pattern.includes('*')) {
                            // Fix: Handle glob patterns correctly
                            let basePattern;
                            if (pattern.endsWith('/**/*')) {
                                basePattern = pattern.replace('/**/*', '/');
                            } else if (pattern.endsWith('**/*')) {
                                basePattern = pattern.replace('**/*', '');
                            } else {
                                basePattern = pattern
                                    .replace(/\*+/g, '')
                                    .replace(/\/+/g, '/');
                            }
                            return filePath.includes(basePattern);
                        }
                        return (
                            filePath === pattern ||
                            filePath.endsWith('/' + pattern)
                        );
                    });

                    if (isRuleFile) {
                        // Determine change type
                        let changeType: RuleFileChangeType;
                        if (commit.added?.includes(filePath)) {
                            changeType = RuleFileChangeType.CREATED;
                        } else if (commit.modified?.includes(filePath)) {
                            changeType = RuleFileChangeType.MODIFIED;
                        } else if (commit.removed?.includes(filePath)) {
                            changeType = RuleFileChangeType.DELETED;
                        } else {
                            changeType = RuleFileChangeType.MODIFIED; // Default
                        }

                        ruleFileChanges.push({
                            filePath,
                            changeType,
                            content:
                                changeType !== RuleFileChangeType.DELETED
                                    ? undefined
                                    : undefined, // Content will be fetched later
                            commitSha: commit.id || commit.sha,
                            timestamp: new Date(commit.timestamp || Date.now()),
                            author: {
                                name:
                                    commit.author?.name ||
                                    commit.committer?.name ||
                                    'Unknown',
                                email:
                                    commit.author?.email ||
                                    commit.committer?.email ||
                                    'unknown@example.com',
                            },
                            repositoryId:
                                webhookEvent.repository?.id?.toString() || '',
                            branch: this.extractBranchFromRef(
                                webhookEvent.ref ||
                                    `refs/heads/${defaultBranch}`,
                            ),
                        });
                        processedFiles.add(filePath); // Mark as processed
                    }
                }
            }

            // Handle renamed files if available
            if (webhookEvent.commits) {
                for (const commit of webhookEvent.commits) {
                    if (commit.renamed && Array.isArray(commit.renamed)) {
                        for (const renamedFile of commit.renamed) {
                            const oldPath =
                                renamedFile.from || renamedFile.old_path;
                            const newPath =
                                renamedFile.to || renamedFile.new_path;

                            const isOldRuleFile = RULE_FILE_PATTERNS.some(
                                (pattern) => {
                                    if (pattern.includes('*')) {
                                        // Fix: Handle glob patterns correctly
                                        let basePattern;
                                        if (pattern.endsWith('/**/*')) {
                                            basePattern = pattern.replace(
                                                '/**/*',
                                                '/',
                                            );
                                        } else if (pattern.endsWith('**/*')) {
                                            basePattern = pattern.replace(
                                                '**/*',
                                                '',
                                            );
                                        } else {
                                            basePattern = pattern
                                                .replace(/\*+/g, '')
                                                .replace(/\/+/g, '/');
                                        }
                                        return oldPath?.includes(basePattern);
                                    }
                                    return oldPath === pattern;
                                },
                            );

                            const isNewRuleFile = RULE_FILE_PATTERNS.some(
                                (pattern) => {
                                    if (pattern.includes('*')) {
                                        // Fix: Handle glob patterns correctly
                                        let basePattern;
                                        if (pattern.endsWith('/**/*')) {
                                            basePattern = pattern.replace(
                                                '/**/*',
                                                '/',
                                            );
                                        } else if (pattern.endsWith('**/*')) {
                                            basePattern = pattern.replace(
                                                '**/*',
                                                '',
                                            );
                                        } else {
                                            basePattern = pattern
                                                .replace(/\*+/g, '')
                                                .replace(/\/+/g, '/');
                                        }
                                        return newPath?.includes(basePattern);
                                    }
                                    return newPath === pattern;
                                },
                            );

                            if (isOldRuleFile || isNewRuleFile) {
                                ruleFileChanges.push({
                                    filePath: newPath,
                                    changeType: RuleFileChangeType.RENAMED,
                                    previousFilePath: oldPath,
                                    commitSha: commit.id || commit.sha,
                                    timestamp: new Date(
                                        commit.timestamp || Date.now(),
                                    ),
                                    author: {
                                        name: commit.author?.name || 'Unknown',
                                        email:
                                            commit.author?.email ||
                                            'unknown@example.com',
                                    },
                                    repositoryId:
                                        webhookEvent.repository?.id?.toString() ||
                                        '',
                                    branch: this.extractBranchFromRef(
                                        webhookEvent.ref ||
                                            `refs/heads/${defaultBranch}`,
                                    ),
                                });
                            }
                        }
                    }
                }
            }

            this.logger.log({
                message: 'Extracted rule file changes from webhook',
                context: RuleFileSyncService.name,
                metadata: {
                    repository: webhookEvent.repository?.name,
                    commits: commits.length,
                    ruleFileChanges: ruleFileChanges.length,
                    ruleFiles: ruleFileChanges.map((f) => f.filePath),
                },
            });

            return ruleFileChanges;
        } catch (error) {
            this.logger.error({
                message: 'Failed to extract rule file changes from webhook',
                context: RuleFileSyncService.name,
                error,
                metadata: {
                    webhookEvent: JSON.stringify(webhookEvent).substring(
                        0,
                        500,
                    ),
                },
            });
            return [];
        }
    }

    /**
     * Extract branch name from Git ref
     */
    private extractBranchFromRef(ref: string): string {
        if (!ref) return 'main';

        // Handle refs/heads/branch-name format
        if (ref.startsWith('refs/heads/')) {
            return ref.replace('refs/heads/', '');
        }

        // Handle refs/remotes/origin/branch-name format
        if (ref.startsWith('refs/remotes/origin/')) {
            return ref.replace('refs/remotes/origin/', '');
        }

        // Handle origin/branch-name format
        if (ref.startsWith('origin/')) {
            return ref.replace('origin/', '');
        }

        // Return as-is if no prefix found
        return ref;
    }

    /**
     * Map origin string to KodyRulesOrigin enum
     */
    private mapOriginToKodyRulesOrigin(origin: string): KodyRulesOrigin {
        switch (origin?.toLowerCase()) {
            case 'onboarding':
                return KodyRulesOrigin.REPOSITORY_FILE;
            case 'webhook':
                return KodyRulesOrigin.REPOSITORY_FILE;
            case 'reconciliation':
                return KodyRulesOrigin.REPOSITORY_FILE;
            case 'manual':
                return KodyRulesOrigin.USER;
            default:
                return KodyRulesOrigin.REPOSITORY_FILE;
        }
    }

    private async syncRulesToDatabase(
        rules: IParsedRuleContent[],
        context: IRuleFileSyncContext,
        origin: string,
    ): Promise<{
        created: number;
        updated: number;
        deleted: number;
        skipped: number;
    }> {
        const stats = { created: 0, updated: 0, deleted: 0, skipped: 0 };

        try {
            this.logger.debug({
                message: '🔍 [DEBUG] Starting database synchronization',
                context: RuleFileSyncService.name,
                metadata: {
                    rulesCount: rules.length,
                    repositoryId: context.repositoryId,
                    origin,
                    rulesTitles: rules.map((r) => r.title),
                },
            });

            // Get existing Kody Rules for this repository
            const existingKodyRules = await this.kodyRulesService.find({
                organizationId: context.organizationId,
                repositoryId: context.repositoryId,
            } as any);

            this.logger.debug({
                message: '🔍 [DEBUG] Existing rules in database',
                context: RuleFileSyncService.name,
                metadata: {
                    existingKodyRulesCount: existingKodyRules?.length || 0,
                    existingRules:
                        existingKodyRules?.flatMap((kr) =>
                            kr.rules?.map((r) => ({
                                title: r.title,
                                path: r.path,
                            })),
                        ) || [],
                },
            });

            // Convert existing rules to a map for easier lookup (title + path + sourceFile)
            const existingRulesMap = new Map();
            if (existingKodyRules && existingKodyRules.length > 0) {
                existingKodyRules.forEach((kodyRule) => {
                    if (kodyRule.rules) {
                        kodyRule.rules.forEach((rule) => {
                            // Use title + path + sourceFile as unique key
                            const key = `${rule.title}|${rule.path || ''}|${rule.sourceFile || ''}`;
                            existingRulesMap.set(key, {
                                kodyRuleId: kodyRule.uuid,
                                rule,
                            });
                        });
                    }
                });
            }

            this.logger.debug({
                message: '🔍 [DEBUG] Existing rules map created',
                context: RuleFileSyncService.name,
                metadata: {
                    mapSize: existingRulesMap.size,
                    mapKeys: Array.from(existingRulesMap.keys()),
                },
            });

            // Process each parsed rule
            for (const parsedRule of rules) {
                try {
                    const ruleKey = `${parsedRule.title}|${parsedRule.path || ''}|${parsedRule.sourceFile || ''}`;
                    const existingRule = existingRulesMap.get(ruleKey);

                    this.logger.debug({
                        message: '🔍 [DEBUG] Processing rule',
                        context: RuleFileSyncService.name,
                        metadata: {
                            ruleTitle: parsedRule.title,
                            ruleKey,
                            hasExisting: !!existingRule,
                        },
                    });

                    if (existingRule) {
                        // Update existing rule if content changed
                        const hasChanges =
                            existingRule.rule.rule !== parsedRule.rule ||
                            existingRule.rule.severity !==
                                parsedRule.severity ||
                            JSON.stringify(existingRule.rule.examples) !==
                                JSON.stringify(parsedRule.examples);

                        if (hasChanges) {
                            await this.kodyRulesService.updateRule(
                                existingRule.kodyRuleId,
                                existingRule.rule.uuid,
                                {
                                    rule: parsedRule.rule,
                                    severity: parsedRule.severity,
                                    examples: parsedRule.examples,
                                    status: KodyRulesStatus.ACTIVE,
                                    origin: this.mapOriginToKodyRulesOrigin(
                                        origin,
                                    ),
                                    updatedAt: new Date(),
                                },
                            );
                            stats.updated++;

                            this.logger.debug({
                                message: 'Updated existing rule',
                                context: RuleFileSyncService.name,
                                metadata: { title: parsedRule.title },
                            });
                        } else {
                            stats.skipped++;
                        }
                    } else {
                        // Create new rule
                        const newRule: Partial<IKodyRule> = {
                            uuid: uuidv4(),
                            title: parsedRule.title,
                            rule: parsedRule.rule,
                            path: parsedRule.path,
                            sourceFile: parsedRule.sourceFile,
                            status: KodyRulesStatus.ACTIVE,
                            severity: parsedRule.severity || 'medium',
                            examples: parsedRule.examples,
                            repositoryId: context.repositoryId,
                            origin: this.mapOriginToKodyRulesOrigin(origin),
                            scope: parsedRule.scope,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        };

                        // Find or create KodyRules document for this repository
                        let kodyRules = existingKodyRules?.[0];
                        if (!kodyRules) {
                            // Create new KodyRules document
                            kodyRules = await this.kodyRulesService.create({
                                organizationId: context.organizationId,
                                rules: [newRule],
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            });
                        } else {
                            // Add rule to existing document
                            await this.kodyRulesService.addRule(
                                kodyRules.uuid,
                                newRule,
                            );
                        }

                        stats.created++;

                        this.logger.debug({
                            message: 'Created new rule',
                            context: RuleFileSyncService.name,
                            metadata: { title: parsedRule.title },
                        });
                    }
                } catch (error) {
                    this.logger.error({
                        message: 'Failed to sync individual rule',
                        context: RuleFileSyncService.name,
                        error,
                        metadata: { title: parsedRule.title },
                    });
                    stats.skipped++;
                }
            }

            this.logger.log({
                message: 'Database synchronization completed',
                context: RuleFileSyncService.name,
                metadata: {
                    repositoryId: context.repositoryId,
                    origin,
                    stats,
                },
            });

            return stats;
        } catch (error) {
            this.logger.error({
                message: 'Failed to sync rules to database',
                context: RuleFileSyncService.name,
                error,
                metadata: {
                    rulesCount: rules.length,
                    repositoryId: context.repositoryId,
                },
            });
            return stats;
        }
    }

    /**
     * Detect repository context for better LLM analysis
     */
    private async detectRepositoryContext(
        context: IRuleFileSyncContext,
    ): Promise<{
        language?: string;
        framework?: string;
        name: string;
    }> {
        try {
            this.logger.debug({
                message: 'Detecting repository context',
                context: RuleFileSyncService.name,
                metadata: { repositoryId: context.repositoryId },
            });

            // Get default branch if not provided in context
            const defaultBranch =
                context.branch ||
                (await this.getRepositoryDefaultBranch(
                    context.organizationId,
                    context.repositoryId,
                    context.repositoryName,
                    context.teamId,
                ));

            // Use existing language detection service if available
            let detectedLanguage: string | undefined;
            let detectedFramework: string | undefined;

            try {
                const languageData =
                    await this.codeManagementService.getLanguageRepository({
                        organizationAndTeamData: {
                            organizationId: context.organizationId,
                            teamId: context.teamId,
                        },
                        repository: {
                            name: context.repositoryName,
                            id: context.repositoryId,
                        },
                    });

                if (languageData && typeof languageData === 'object') {
                    // Get primary language (assuming it returns language stats)
                    if (Array.isArray(languageData)) {
                        detectedLanguage = languageData[0]?.language;
                    } else if (languageData.primaryLanguage) {
                        detectedLanguage = languageData.primaryLanguage;
                    } else {
                        // Find most used language from stats
                        const languages = Object.keys(languageData);
                        if (languages.length > 0) {
                            detectedLanguage = languages[0];
                        }
                    }
                }
            } catch (error) {
                this.logger.debug({
                    message:
                        'Language detection service unavailable, using manual detection',
                    context: RuleFileSyncService.name,
                    error,
                });
            }

            // Manual framework detection by looking for specific files
            try {
                const configFiles =
                    await this.codeManagementService.getRepositoryAllFiles({
                        repository: context.repositoryName,
                        organizationName: context.organizationId,
                        branch: defaultBranch,
                        organizationAndTeamData: {
                            organizationId: context.organizationId,
                            teamId: context.teamId,
                        },
                        filePatterns: [
                            'package.json',
                            'requirements.txt',
                            'pom.xml',
                            'Cargo.toml',
                            'go.mod',
                            'composer.json',
                            'Gemfile',
                            'setup.py',
                            'tsconfig.json',
                            'angular.json',
                            'next.config.js',
                            'nuxt.config.js',
                            'vue.config.js',
                            'svelte.config.js',
                            '.csproj',
                            'build.gradle',
                        ],
                        maxFiles: 20,
                    });

                if (configFiles && configFiles.length > 0) {
                    // Analyze config files to detect framework and language
                    for (const file of configFiles) {
                        const fileName = file.path?.toLowerCase() || '';

                        // Language detection
                        if (!detectedLanguage) {
                            if (
                                fileName.includes('package.json') ||
                                fileName.includes('tsconfig.json')
                            ) {
                                detectedLanguage = fileName.includes('tsconfig')
                                    ? 'TypeScript'
                                    : 'JavaScript';
                            } else if (
                                fileName.includes('requirements.txt') ||
                                fileName.includes('setup.py')
                            ) {
                                detectedLanguage = 'Python';
                            } else if (
                                fileName.includes('pom.xml') ||
                                fileName.includes('build.gradle')
                            ) {
                                detectedLanguage = 'Java';
                            } else if (fileName.includes('cargo.toml')) {
                                detectedLanguage = 'Rust';
                            } else if (fileName.includes('go.mod')) {
                                detectedLanguage = 'Go';
                            } else if (fileName.includes('composer.json')) {
                                detectedLanguage = 'PHP';
                            } else if (fileName.includes('gemfile')) {
                                detectedLanguage = 'Ruby';
                            } else if (fileName.includes('.csproj')) {
                                detectedLanguage = 'C#';
                            }
                        }

                        // Framework detection
                        if (!detectedFramework) {
                            if (fileName.includes('angular.json')) {
                                detectedFramework = 'Angular';
                            } else if (fileName.includes('next.config')) {
                                detectedFramework = 'Next.js';
                            } else if (fileName.includes('nuxt.config')) {
                                detectedFramework = 'Nuxt.js';
                            } else if (fileName.includes('vue.config')) {
                                detectedFramework = 'Vue.js';
                            } else if (fileName.includes('svelte.config')) {
                                detectedFramework = 'Svelte';
                            }
                        }
                    }

                    // Additional framework detection by analyzing package.json content
                    const packageJsonFile = configFiles.find((f) =>
                        f.path?.endsWith('package.json'),
                    );
                    if (packageJsonFile && !detectedFramework) {
                        try {
                            const packageContent =
                                await this.codeManagementService.getRepositoryContentFile(
                                    {
                                        organizationAndTeamData: {
                                            organizationId:
                                                context.organizationId,
                                            teamId: context.teamId,
                                        },
                                        repository: {
                                            name: context.repositoryName,
                                            id: context.repositoryId,
                                        },
                                        file: { path: packageJsonFile.path },
                                        pullRequest: null,
                                    },
                                );

                            if (packageContent?.content) {
                                const packageJson = JSON.parse(
                                    packageContent.content,
                                );
                                const dependencies = {
                                    ...packageJson.dependencies,
                                    ...packageJson.devDependencies,
                                };

                                if (
                                    dependencies.react ||
                                    dependencies['@types/react']
                                ) {
                                    detectedFramework = dependencies.next
                                        ? 'Next.js'
                                        : 'React';
                                } else if (
                                    dependencies.vue ||
                                    dependencies['@vue/cli']
                                ) {
                                    detectedFramework = 'Vue.js';
                                } else if (
                                    dependencies.angular ||
                                    dependencies['@angular/core']
                                ) {
                                    detectedFramework = 'Angular';
                                } else if (dependencies.svelte) {
                                    detectedFramework = 'Svelte';
                                } else if (dependencies.express) {
                                    detectedFramework = 'Express.js';
                                } else if (dependencies['@nestjs/core']) {
                                    detectedFramework = 'NestJS';
                                }
                            }
                        } catch (error) {
                            this.logger.debug({
                                message:
                                    'Failed to parse package.json for framework detection',
                                context: RuleFileSyncService.name,
                                error,
                            });
                        }
                    }
                }
            } catch (error) {
                this.logger.debug({
                    message: 'Manual framework detection failed',
                    context: RuleFileSyncService.name,
                    error,
                });
            }

            const repositoryContext = {
                name: context.repositoryName,
                language: detectedLanguage,
                framework: detectedFramework,
            };

            this.logger.log({
                message: 'Repository context detected',
                context: RuleFileSyncService.name,
                metadata: {
                    repositoryId: context.repositoryId,
                    repositoryContext,
                },
            });

            return repositoryContext;
        } catch (error) {
            this.logger.warn({
                message: 'Failed to detect repository context',
                context: RuleFileSyncService.name,
                error,
                metadata: { repositoryId: context.repositoryId },
            });

            return {
                name: context.repositoryName,
            };
        }
    }

    /**
     * Process a rule file change using LLM
     */
    private async processRuleFileChangeWithLLM(
        change: IRuleFileChange,
        context: IRuleFileSyncContext,
        repositoryContext: any,
        branch: string,
    ): Promise<any> {
        try {
            // ✅ If content is empty, fetch it from the repository
            let fileContent: any = change.content;

            if (!fileContent) {
                this.logger.debug({
                    message: 'File content is empty, fetching from repository',
                    context: RuleFileSyncService.name,
                    metadata: {
                        filePath: change.filePath,
                        repositoryId: context.repositoryId,
                        branch: context.branch || change.branch,
                    },
                });

                try {
                    // Fetch file content using CodeManagementService
                    const fileContentResponse =
                        await this.codeManagementService.getRepositoryContentFile(
                            {
                                organizationAndTeamData: {
                                    organizationId: context.organizationId,
                                    teamId: context.teamId,
                                },
                                repository: {
                                    id: context.repositoryId,
                                    name: context.repositoryName,
                                },
                                file: { filename: change.filePath },
                                pullRequest: { head: { ref: branch } },
                            },
                        );

                    fileContent = fileContentResponse;

                    if (!fileContent) {
                        this.logger.warn({
                            message:
                                'Could not fetch file content from repository',
                            context: RuleFileSyncService.name,
                            metadata: {
                                filePath: change.filePath,
                                repositoryId: context.repositoryId,
                                branch: context.branch || change.branch,
                            },
                        });
                        return {
                            created: 0,
                            updated: 0,
                            deleted: 0,
                            skipped: 1,
                            errors: [],
                        };
                    }
                } catch (fetchError) {
                    this.logger.error({
                        message: 'Failed to fetch file content from repository',
                        context: RuleFileSyncService.name,
                        error: fetchError,
                        metadata: {
                            filePath: change.filePath,
                            repositoryId: context.repositoryId,
                        },
                    });
                    return {
                        created: 0,
                        updated: 0,
                        deleted: 0,
                        skipped: 0,
                        errors: [
                            {
                                filePath: change.filePath,
                                error: `Failed to fetch content: ${fetchError.message}`,
                                type: 'fetch',
                            },
                        ],
                    };
                }
            }

            let decodedContent = fileContent;

            if (fileContent && fileContent?.data?.encoding === 'base64') {
                decodedContent = Buffer.from(
                    fileContent?.data?.content,
                    'base64',
                ).toString('utf-8');
            }

            this.logger.debug({
                message: '�� [DEBUG] Processing rule file with LLM',
                context: RuleFileSyncService.name,
                metadata: {
                    filePath: change.filePath,
                    contentLength: decodedContent.length,
                },
            });

            const parseResult =
                await this.llmRuleExtractionService.extractRulesFromFile(
                    change.filePath,
                    decodedContent,
                    repositoryContext,
                );

            this.logger.debug({
                message: '🔍 [DEBUG] LLM extraction completed',
                context: RuleFileSyncService.name,
                metadata: {
                    filePath: change.filePath,
                    success: parseResult.success,
                    rulesCount: parseResult.rules?.length || 0,
                    extractedRules:
                        parseResult.rules?.map((r) => ({
                            title: r.title,
                            path: r.path,
                        })) || [],
                },
            });

            if (!parseResult.success || parseResult.rules.length === 0) {
                this.logger.debug({
                    message: '⚠️ [DEBUG] No rules extracted from file',
                    context: RuleFileSyncService.name,
                    metadata: { filePath: change.filePath },
                });
                return {
                    created: 0,
                    updated: 0,
                    deleted: 0,
                    skipped: 1,
                    errors: [],
                };
            }

            this.logger.debug({
                message: '🔍 [DEBUG] About to sync rules to database',
                context: RuleFileSyncService.name,
                metadata: {
                    filePath: change.filePath,
                    rulesBeingSync: parseResult.rules.map((r) => ({
                        title: r.title,
                        path: r.path,
                    })),
                },
            });

            // Sync extracted rules to database
            const syncResult = await this.syncRulesToDatabase(
                parseResult.rules,
                context,
                'webhook',
            );

            this.logger.log({
                message: 'Successfully processed rule file with LLM',
                context: RuleFileSyncService.name,
                metadata: {
                    filePath: change.filePath,
                    rulesExtracted: parseResult.rules.length,
                    syncResult,
                },
            });

            return {
                ...syncResult,
                errors: parseResult.errors || [],
            };
        } catch (error) {
            this.logger.error({
                message: 'Failed to process rule file change with LLM',
                context: RuleFileSyncService.name,
                error,
                metadata: { filePath: change.filePath },
            });

            return {
                created: 0,
                updated: 0,
                deleted: 0,
                skipped: 0,
                errors: [
                    {
                        filePath: change.filePath,
                        error: error.message,
                        type: 'parsing',
                    },
                ],
            };
        }
    }

    /**
     * Process rule file deletion
     */
    private async processRuleFileDeletion(
        change: IRuleFileChange,
        context: IRuleFileSyncContext,
    ): Promise<any> {
        try {
            this.logger.log({
                message: 'Processing rule file deletion',
                context: RuleFileSyncService.name,
                metadata: {
                    filePath: change.filePath,
                    repositoryId: context.repositoryId,
                },
            });

            // Get existing Kody Rules for this repository
            const existingKodyRules = await this.kodyRulesService.find({
                organizationId: context.organizationId,
                repositoryId: context.repositoryId,
            } as any);

            let deletedCount = 0;
            const errors: any[] = [];

            if (existingKodyRules && existingKodyRules.length > 0) {
                for (const kodyRule of existingKodyRules) {
                    if (kodyRule.rules) {
                        // Find rules that vieram desse arquivo de origem (sourceFile)
                        const rulesToDelete = kodyRule.rules.filter(
                            (rule) => rule.sourceFile === change.filePath,
                        );

                        // Deactivate/delete rules from this file
                        for (const rule of rulesToDelete) {
                            try {
                                if (rule.uuid) {
                                    // Use logical deletion (set status to DELETED)
                                    await this.kodyRulesService.deleteRuleLogically(
                                        kodyRule.uuid,
                                        rule.uuid,
                                    );
                                    deletedCount++;

                                    this.logger.debug({
                                        message:
                                            'Logically deleted rule from deleted file',
                                        context: RuleFileSyncService.name,
                                        metadata: {
                                            ruleTitle: rule.title,
                                            filePath: change.filePath,
                                        },
                                    });
                                }
                            } catch (error) {
                                errors.push({
                                    filePath: change.filePath,
                                    error: `Failed to delete rule "${rule.title}": ${error.message}`,
                                    type: 'deletion',
                                });

                                this.logger.error({
                                    message: 'Failed to delete individual rule',
                                    context: RuleFileSyncService.name,
                                    error,
                                    metadata: {
                                        ruleTitle: rule.title,
                                        filePath: change.filePath,
                                    },
                                });
                            }
                        }
                    }
                }
            }

            this.logger.log({
                message: 'Rule file deletion processing completed',
                context: RuleFileSyncService.name,
                metadata: {
                    filePath: change.filePath,
                    deletedRules: deletedCount,
                    errors: errors.length,
                },
            });

            return {
                created: 0,
                updated: 0,
                deleted: deletedCount,
                skipped: 0,
                errors,
            };
        } catch (error) {
            this.logger.error({
                message: 'Failed to process rule file deletion',
                context: RuleFileSyncService.name,
                error,
            });
            return {
                created: 0,
                updated: 0,
                deleted: 0,
                skipped: 0,
                errors: [
                    {
                        filePath: change.filePath,
                        error: error.message,
                        type: 'deletion',
                    },
                ],
            };
        }
    }

    /**
     * Atualiza o campo sourceFile das regras existentes ao detectar rename de arquivo de regras
     */
    private async processRuleFileRename(
        oldFilePath: string,
        newFilePath: string,
        context: IRuleFileSyncContext,
    ): Promise<void> {
        // Busca todas as regras com sourceFile = oldFilePath e atualiza para newFilePath
        const existingKodyRules = await this.kodyRulesService.find({
            organizationId: context.organizationId,
            repositoryId: context.repositoryId,
        } as any);

        if (existingKodyRules && existingKodyRules.length > 0) {
            for (const kodyRule of existingKodyRules) {
                if (kodyRule.rules) {
                    for (const rule of kodyRule.rules) {
                        if (rule.sourceFile === oldFilePath && rule.uuid) {
                            await this.kodyRulesService.updateRule(
                                kodyRule.uuid,
                                rule.uuid,
                                {
                                    sourceFile: newFilePath,
                                    updatedAt: new Date(),
                                },
                            );
                            this.logger.debug({
                                message: 'Updated rule sourceFile due to file rename',
                                context: RuleFileSyncService.name,
                                metadata: {
                                    ruleTitle: rule.title,
                                    oldFilePath,
                                    newFilePath,
                                },
                            });
                        }
                    }
                }
            }
        }
    }
}
