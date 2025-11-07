import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { DryRunEntity } from '../entities/dryRun.entity';
import { DryRunStatus, IDryRun } from '../interfaces/dryRun.interface';
import { IDryRunRepository } from './dryRun.repository.contract';
import {
    CodeReviewConfig,
    FileChange,
} from '@/config/types/general/codeReview.type';
import {
    IFile,
    IPullRequests,
    ISuggestion,
    ISuggestionByPR,
} from '../../pullRequests/interfaces/pullRequests.interface';
import { IPullRequestMessages } from '../../pullRequestMessages/interfaces/pullRequestMessages.interface';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { IPullRequestsService } from '../../pullRequests/contracts/pullRequests.service.contracts';

export const DRY_RUN_SERVICE_TOKEN = Symbol('DRY_RUN_SERVICE_TOKEN');

export interface IDryRunService extends IDryRunRepository {
    findById(id: string): Promise<DryRunEntity | null>;

    listDryRuns(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        filters?: {
            repositoryId?: string;
            directoryId?: string;
            startDate?: Date;
            endDate?: Date;
            prNumber?: number;
            status?: string;
        };
    }): Promise<IDryRun['runs']>;

    findDryRunById(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        id: string;
    }): Promise<IDryRun['runs'][number] | null>;

    initializeDryRun(params: {
        id?: string;
        status?: DryRunStatus;
        organizationAndTeamData: OrganizationAndTeamData;
        provider: IPullRequests['provider'];
        prNumber: number;
        prTitle: string;
        repositoryId: string;
        repositoryName: string;
        directoryId?: string;
    }): Promise<IDryRun['runs'][number]>;

    addConfigsToDryRun(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        id: string;
        config: CodeReviewConfig;
        configId: string;
        pullRequestMessagesConfig?: IPullRequestMessages;
        pullRequestMessagesId?: string;
    }): Promise<IDryRun['runs'][number] | null>;

    addMessageToDryRun(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        id: string;
        content: string;
        path?: string;
        lines?: {
            start: number;
            end: number;
        };
        severity?: string;
        category?: string;
        language?: string;
        existingCode?: string;
        improvedCode?: string;
    }): Promise<IDryRun['runs'][number] | null>;

    updateMessageInDryRun(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        id: string;
        commentId: number;
        content: string;
    }): Promise<IDryRun['runs'][number] | null>;

    updateDescriptionInDryRun(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        id: string;
        description: string;
    }): Promise<IDryRun['runs'][number] | null>;

    updateDryRunStatus(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        id: string;
        status: DryRunStatus;
    }): Promise<IDryRun['runs'][number] | null>;

    removeDryRunByHash(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        id: string;
    }): Promise<IDryRun | null>;

    clearDryRuns(params: {
        organizationAndTeamData: OrganizationAndTeamData;
    }): Promise<void>;

    addPrLevelSuggestions(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        id: string;
        prLevelSuggestions: ISuggestionByPR[];
    }): Promise<IDryRun['runs'][number] | null>;

    addFilesToDryRun(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        id: string;
        files: FileChange[];
        prioritizedSuggestions?: ISuggestion[];
        unusedSuggestions?: ISuggestion[];
    }): Promise<IDryRun['runs'][number] | null>;
}
