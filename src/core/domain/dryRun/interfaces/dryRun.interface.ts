import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { IPullRequestMessages } from '../../pullRequestMessages/interfaces/pullRequestMessages.interface';
import { IPullRequests } from '../../pullRequests/interfaces/pullRequests.interface';
import { CodeReviewParameter } from '@/config/types/general/codeReviewConfig.type';
import { string } from 'joi';

export enum DryRunStatus {
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

export interface IDryRun {
    uuid: string;
    createdAt: Date;
    updatedAt: Date;

    organizationId: string;
    teamId: string;

    runs: IDryRunData[];
}

export interface IDryRunData {
    id: string;
    status: DryRunStatus;
    events: IDryRunEvent[]; // Historical events for this dry run

    dependents: IDryRunData['id'][]; // Ids of dry runs that reference this one
    createdAt: Date;
    updatedAt: Date;

    provider: IPullRequests['provider'];
    prNumber: number;
    prTitle: string;
    repositoryId: string;
    repositoryName: string;
    directoryId?: string;

    description: string;
    messages: IDryRunMessage[];
    files: Partial<IPullRequests['files'][number]>[] | IDryRunData['id']; // Changed files or reference to another dry run
    prLevelSuggestions:
        | Partial<IPullRequests['prLevelSuggestions'][number]>[]
        | IDryRunData['id']; // PR level suggestions or reference to another dry run

    config: string; // ID of the code review config used
    pullRequestMessages: string; // ID of the pull request messages used

    configHashes: {
        full: string; // Hash of the full config
        basic: string; // Hash of configs that do not affect LLM behavior
        llm: string; // Hash of configs that affect LLM behavior
    };
}

export interface IDryRunMessage {
    id: number;
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
}

export enum DryRunEventType {
    MESSAGE_ADDED = 'MESSAGE_ADDED',
    MESSAGE_UPDATED = 'MESSAGE_UPDATED',
    DESCRIPTION_UPDATED = 'DESCRIPTION_UPDATED',
    STATUS_UPDATED = 'STATUS_UPDATED',
    REMOVED = 'REMOVED',
}

export interface IDryRunBaseEvent {
    id: string;
    dryRunId: string;
    organizationId: string;
    teamId: string;
    type: DryRunEventType;
    payload: any;
    timestamp: Date;
}

export interface IDryRunMessageAddedEvent extends IDryRunBaseEvent {
    type: DryRunEventType.MESSAGE_ADDED;
    payload: IDryRunMessageAddedPayload;
}

export interface IDryRunMessageAddedPayload {
    message: IDryRunMessage;
}

export interface IDryRunMessageUpdatedEvent extends IDryRunBaseEvent {
    type: DryRunEventType.MESSAGE_UPDATED;
    payload: IDryRunMessageUpdatedPayload;
}

export interface IDryRunMessageUpdatedPayload {
    messageId: number;
    content: string;
}

export interface IDryRunDescriptionUpdatedEvent extends IDryRunBaseEvent {
    type: DryRunEventType.DESCRIPTION_UPDATED;
    payload: IDryRunDescriptionUpdatedPayload;
}

export interface IDryRunDescriptionUpdatedPayload {
    description: string;
}

export interface IDryRunStatusUpdatedEvent extends IDryRunBaseEvent {
    type: DryRunEventType.STATUS_UPDATED;
    payload: IDryRunStatusUpdatedPayload;
}

export interface IDryRunStatusUpdatedPayload {
    status: DryRunStatus;
}

export interface IDryRunRemovedEvent extends IDryRunBaseEvent {
    type: DryRunEventType.REMOVED;
    payload: IDryRunRemovedPayload;
}

export interface IDryRunRemovedPayload {}

export type IDryRunEvent =
    | IDryRunMessageAddedEvent
    | IDryRunMessageUpdatedEvent
    | IDryRunDescriptionUpdatedEvent
    | IDryRunStatusUpdatedEvent
    | IDryRunRemovedEvent;

export type IDryRunPayloadMap = {
    [T in DryRunEventType]: Extract<IDryRunEvent, { type: T }>['payload'];
};
