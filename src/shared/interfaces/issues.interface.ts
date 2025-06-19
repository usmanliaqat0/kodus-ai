import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PlatformType } from '../domain/enums/platform-type.enum';
import { LabelType } from '../utils/codeManagement/labels';
import { SeverityLevel } from '../utils/enums/severityLevel.enum';
import { ISuggestion } from '@/core/domain/pullRequests/interfaces/pullRequests.interface';

export enum IssueStatus {
    DISMISSED = 'dismissed',
    OPEN = 'open',
    RESOLVED = 'resolved',
}

export type IssuesFilters = {
    repositoryName?: string;
    label?: string;
    severity?: string;
    startDate?: Date;
    endDate?: Date;
    prAuthor?: string;
    fileName?: string;
    prNumber?: number;
    issueStatus?: IssueStatus;
};

export interface IIssue {
    id: string;
    title: string;
    description: string;
    label: LabelType;
    severity: SeverityLevel;
    language: string;
    age: string;
    status: IssueStatus;
    createdAt: string;
    filePath: string;
    prNumber: number;
    prAuthor: string;
    repositoryName: string;
    organizationId: string;
    file?: {
        id: string;
        name: string;
        path: string;
    };
    repository?: {
        id: string;
        name: string;
        fullName: string;
        url: string;
    };
    suggestion?: ISuggestion;
    prUrl?: string;
    provider?: string;
}

export interface IIssueDetails {
    title: string;
    description: string;
    age: string;
    label: LabelType;
    severity: SeverityLevel;
    status: IssueStatus;
    fileLink: {
        label: string;
        url: string;
    };
    prLink: {
        label: string;
        url: string;
    };
    repositoryLink: {
        label: string;
        url: string;
    };
    existingCode: string;
    improvedCode: string;
    language: string;
    startLine: number;
    endLine: number;
    reactions: {
        thumbsUp: number;
        thumbsDown: number;
    };
    gitOrganizationName: string;
    platform: PlatformType;
}

export interface IRepositoryToIssues {
    id: string;
    name: string;
    full_name: string;
    url?: string;
}

export type contextToGenerateIssues = {
    organizationAndTeamData: OrganizationAndTeamData;
    repository: IRepositoryToIssues;
    pullRequest: any;
    prFiles?: any[];
};
