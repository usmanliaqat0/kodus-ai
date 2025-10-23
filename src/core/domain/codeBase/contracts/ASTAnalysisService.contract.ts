import {
    AIAnalysisResult,
    AnalysisContext,
    ReviewModeResponse,
} from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    GetImpactAnalysisResponse,
    InitializeImpactAnalysisResponse,
    InitializeRepositoryResponse,
    GetTaskInfoResponse,
} from '@/ee/kodyAST/codeASTAnalysis.service';

export const AST_ANALYSIS_SERVICE_TOKEN = Symbol('ASTAnalysisService');

export interface IASTAnalysisService {
    awaitTask(
        taskId: string,
        organizationAndTeamData: OrganizationAndTeamData,
        options?: {
            timeout?: number;
            initialInterval?: number;
            maxInterval?: number;
            useExponentialBackoff?: boolean;
        },
    ): Promise<GetTaskInfoResponse>;
    analyzeASTWithAI(
        context: AnalysisContext,
        reviewModeResponse: ReviewModeResponse,
    ): Promise<AIAnalysisResult>;
    initializeASTAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
        filePaths?: string[],
    ): Promise<InitializeRepositoryResponse>;
    deleteASTAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
        taskId: string,
    ): Promise<void>;
    initializeImpactAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
        codeChunk: string,
        fileName: string,
        taskId: string,
    ): Promise<InitializeImpactAnalysisResponse>;
    getImpactAnalysis(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: any,
        taskId: string,
    ): Promise<GetImpactAnalysisResponse>;
    getRelatedContentFromDiff(
        repository: any,
        pullRequest: any,
        platformType: string,
        organizationAndTeamData: OrganizationAndTeamData,
        diff: string,
        filePath: string,
        taskId: string,
    ): Promise<{ content: string }>;
}
