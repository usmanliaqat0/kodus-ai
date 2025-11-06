import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { BYOKConfig } from '@kodus/kodus-common/llm';
import type { ContextRequirement } from '@context-os-core/interfaces';
import {
    IFileReference,
    IPromptReferenceSyncError,
    PromptSourceType,
} from '../interfaces/promptExternalReference.interface';

export const PROMPT_CONTEXT_ENGINE_SERVICE_TOKEN =
    'PROMPT_CONTEXT_ENGINE_SERVICE_TOKEN';

export interface IPromptContextEngineService {
    detectAndResolveReferences(params: {
        requirementId: string;
        path: string[];
        sourceType: PromptSourceType;
        promptText: string;
        repositoryId: string;
        repositoryName: string;
        organizationAndTeamData: OrganizationAndTeamData;
        context?: 'rule' | 'instruction' | 'prompt';
        detectionMode?: 'rule' | 'prompt';
        byokConfig?: BYOKConfig;
    }): Promise<{
        references: IFileReference[];
        syncErrors?: IPromptReferenceSyncError[];
        promptHash: string;
        requirements: ContextRequirement[];
        markers: string[];
    }>;

    calculatePromptHash(promptText: string): string;
}
