import {
    AnalysisContext,
    AutomaticReviewStatus,
    CodeReviewConfig,
    CodeSuggestion,
    CommentResult,
    FileChange,
    Repository,
} from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { AutomationExecutionEntity } from '@/core/domain/automation/entities/automation-execution.entity';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { PipelineContext } from '../../../pipeline/interfaces/pipeline-context.interface';
import { TaskStatus } from '@/ee/kodyAST/codeASTAnalysis.service';
import { ISuggestionByPR } from '@/core/domain/pullRequests/interfaces/pullRequests.interface';
import { IPullRequestMessages } from '@/core/domain/pullRequestMessages/interfaces/pullRequestMessages.interface';
import { IClusterizedSuggestion } from '@/core/domain/kodyFineTuning/interfaces/kodyFineTuning.interface';
import { IExternalPromptContext } from '@/core/domain/prompts/interfaces/promptExternalReference.interface';
import type { ContextLayer, ContextPack } from '@context-os-core/interfaces';
import type { ContextAugmentationsMap } from '@/core/infrastructure/adapters/services/context/code-review-context-pack.service';

export interface CodeReviewPipelineContext extends PipelineContext {
    organizationAndTeamData: OrganizationAndTeamData;
    repository: Repository;
    branch: string;
    pullRequest: {
        number: number;
        title: string;
        base: {
            repo: {
                fullName: string;
            };
            ref: string;
        };
        repository: Repository;
        isDraft: boolean;
        stats: {
            total_additions: number;
            total_deletions: number;
            total_files: number;
            total_lines_changed: number;
        };
        [key: string]: any;
    };
    teamAutomationId: string;
    origin: string;
    action: string;
    platformType: PlatformType;
    triggerCommentId?: number | string;

    codeReviewConfig?: CodeReviewConfig;
    automaticReviewStatus?: AutomaticReviewStatus;

    changedFiles?: FileChange[];
    lastExecution?: {
        commentId?: any;
        noteId?: any;
        threadId?: any;
        lastAnalyzedCommit?: any;
    };
    pipelineMetadata?: {
        lastExecution?: AutomationExecutionEntity;
    };

    initialCommentData?: {
        commentId: number;
        noteId: number;
        threadId?: number;
    };

    pullRequestMessagesConfig?: IPullRequestMessages;

    batches: FileChange[][];

    clusterizedSuggestions?: IClusterizedSuggestion[];

    preparedFileContexts: AnalysisContext[];

    fileAnalysisResults?: Array<{
        validSuggestionsToAnalyze: Partial<CodeSuggestion>[];
        discardedSuggestionsBySafeGuard: Partial<CodeSuggestion>[];
        file: FileChange;
    }>;

    prAnalysisResults?: {
        validSuggestionsByPR?: ISuggestionByPR[];
        validCrossFileSuggestions?: CodeSuggestion[];
    };

    validSuggestions: Partial<CodeSuggestion>[];
    discardedSuggestions: Partial<CodeSuggestion>[];
    lastAnalyzedCommit?: any;

    validSuggestionsByPR?: ISuggestionByPR[];
    validCrossFileSuggestions?: CodeSuggestion[];

    lineComments?: CommentResult[];

    tasks?: {
        astAnalysis?: {
            taskId: string;
            status?: TaskStatus;
        };
    };
    // Resultados dos comentários de nível de PR
    prLevelCommentResults?: Array<CommentResult>;

    // Metadados dos arquivos processados (reviewMode, codeReviewModelUsed, etc.)
    fileMetadata?: Map<string, any>;

    /** Bloco com conteúdos de arquivos externos referenciados pelos prompts. */
    externalPromptContext?: IExternalPromptContext;
    /** Camadas já formatadas para incluir no ContextPack (ex.: arquivos, instruções). */
    externalPromptLayers?: ContextLayer[];

    /** ContextPack compartilhado entre os stages (instruções + camadas externas). */
    sharedContextPack?: ContextPack;
    /** Resultados das execuções MCP agrupados por path/tool para complementar os prompts. */
    sharedContextAugmentations?: ContextAugmentationsMap;
    /** Overrides de prompt sanitizados (sem marcadores MCP) reutilizados entre os stages. */
    sharedSanitizedOverrides?: CodeReviewConfig['v2PromptOverrides'];

    correlationId: string;
}
