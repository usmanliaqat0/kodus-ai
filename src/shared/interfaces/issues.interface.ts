import { OrganizationAndTeamData } from "@/config/types/general/organizationAndTeamData";
import { PlatformType } from "../domain/enums/platform-type.enum";
import { LabelType } from "../utils/codeManagement/labels";
import { SeverityLevel } from "../utils/enums/severityLevel.enum";

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
    uuid?: string;
    title: string;
    description: string;
    filePath: string;
    language: string;
    label: LabelType;
    severity: SeverityLevel;
    repositoryName: string;
    organizationId: string;
    age?: string;
    status?: IssueStatus;
    createdAt: string;
    updatedAt: string;
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
    prLinks: {
        label: string;
        url: string;
    }[];
    repositoryLink: {
        label: string;
        url: string;
    };
    currentCode: string;
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