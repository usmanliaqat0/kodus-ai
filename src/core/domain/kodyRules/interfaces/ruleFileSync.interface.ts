import { KodyRulesScope, KodyRulesStatus } from './kodyRules.interface';
import { KodyRuleSeverity } from '@/core/infrastructure/http/dtos/create-kody-rule.dto';

/**
 * Token for dependency injection of IRuleFileSyncService
 */
export const RULE_FILE_SYNC_SERVICE_TOKEN = 'RULE_FILE_SYNC_SERVICE';

/**
 * Supported rule file patterns that the system should monitor
 */
export const RULE_FILE_PATTERNS = [
    // Cursor
    '.cursorrules',
    '.cursor/rules/**/*',

    // Claude
    'CLAUDE.md',
    '.claude/**/*',

    // Windsurf
    '.windsurfrules',

    // Sourcegraph
    '.sourcegraph/**/*.rule.md',

    // GitHub Copilot
    '.github/copilot-instructions.md',
    '.github/instructions/**/*',

    // Generic rules / internal rules
    '.rules/**/*',
    '.kody/**/*',
    'docs/coding-standards/**/*',
] as const;

/**
 * Types of changes detected in rule files
 */
export enum RuleFileChangeType {
    CREATED = 'created',
    MODIFIED = 'modified',
    RENAMED = 'renamed',
    DELETED = 'deleted',
}

/**
 * Origin source of the rule file sync
 */
export enum RuleFileSyncOrigin {
    WEBHOOK = 'webhook',
    RECONCILIATION = 'reconciliation',
    MANUAL_SYNC = 'manual_sync',
    ONBOARDING = 'onboarding',
}

/**
 * Status of the rule file sync operation
 */
export enum RuleFileSyncStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    FAILED = 'failed',
    SKIPPED = 'skipped',
}

/**
 * Represents a detected rule file change from the repository
 */
export interface IRuleFileChange {
    filePath: string;
    changeType: RuleFileChangeType;
    content?: string;
    previousFilePath?: string; // for renamed files
    commitSha: string;
    timestamp: Date;
    author: {
        name: string;
        email: string;
    };
    repositoryId: string;
    branch: string;
}

/**
 * Parsed rule content from a rule file
 */
export interface IParsedRuleContent {
    title: string;
    rule: string;
    severity?: KodyRuleSeverity;
    scope?: KodyRulesScope;
    path?: string;
    sourceFile: string; // Caminho do arquivo de origem da regra
    examples?: Array<{
        snippet: string;
        isCorrect: boolean;
    }>;
    metadata?: {
        language?: string;
        framework?: string;
        category?: string;
    };
}

/**
 * Result of parsing a rule file
 */
export interface IRuleFileParseResult {
    filePath: string;
    success: boolean;
    rules: IParsedRuleContent[];
    errors?: string[];
    metadata: {
        fileType: string;
        language?: string;
        parsingDuration: number;
    };
}

/**
 * Context for rule sync operations
 */
export interface IRuleFileSyncContext {
    organizationId: string;
    teamId?: string; // ← Add teamId to context
    repositoryId: string;
    repositoryName: string;
    branch?: string;
    pullRequestNumber?: number;
    origin: RuleFileSyncOrigin;
    triggerData?: {
        webhookEvent?: any;
        userId?: string;
        automationId?: string;
    };
}

/**
 * Result of a rule sync operation
 */
export interface IRuleFileSyncResult {
    syncId: string;
    context: IRuleFileSyncContext;
    status: RuleFileSyncStatus;
    changes: IRuleFileChange[];
    processedRules: {
        created: number;
        updated: number;
        deleted: number;
        skipped: number;
    };
    errors?: Array<{
        filePath: string;
        error: string;
        type: 'parsing' | 'sync' | 'validation';
    }>;
    duration: number;
    startedAt: Date;
    completedAt?: Date;
}

/**
 * Configuration for rule file sync behavior
 */
export interface IRuleFileSyncConfig {
    enabled: boolean;
    patterns: string[];
    autoSync: boolean;
    reconciliationInterval: number; // minutes
    maxFileSize: number; // bytes
    skipBinaryFiles: boolean;
    defaultSeverity: KodyRuleSeverity;
    defaultScope: KodyRulesScope;
    conflictResolution: 'repository_wins' | 'kody_wins' | 'manual_review';
}

/**
 * Interface for the rule file sync service
 */
export interface IRuleFileSyncService {
    /**
     * Sync rules from repository files for initial onboarding
     */
    syncOnboarding(context: IRuleFileSyncContext): Promise<IRuleFileSyncResult>;

    /**
     * Process webhook event for rule file changes
     */
    processWebhookEvent(
        webhookEvent: any,
        context: IRuleFileSyncContext,
    ): Promise<IRuleFileSyncResult>;

    /**
     * Perform reconciliation to detect drift between repository and Kody rules
     */
    reconcile(context: IRuleFileSyncContext): Promise<IRuleFileSyncResult>;

    /**
     * Get sync history for a repository
     */
    getSyncHistory(
        organizationId: string,
        repositoryId: string,
        limit?: number,
    ): Promise<IRuleFileSyncResult[]>;
}

/**
 * Interface for rule conflict resolution
 */
export interface IRuleConflictResolver {
    /**
     * Resolve conflicts between repository rules and existing Kody rules
     */
    resolveConflicts(
        repositoryRules: IParsedRuleContent[],
        existingRules: IParsedRuleContent[],
        strategy: IRuleFileSyncConfig['conflictResolution'],
    ): Promise<{
        toCreate: IParsedRuleContent[];
        toUpdate: Array<{
            existing: IParsedRuleContent;
            updated: IParsedRuleContent;
        }>;
        toDelete: IParsedRuleContent[];
        conflicts: Array<{
            repository: IParsedRuleContent;
            existing: IParsedRuleContent;
            reason: string;
        }>;
    }>;
}
