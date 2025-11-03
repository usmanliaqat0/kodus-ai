import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { BYOKConfig } from '@kodus/kodus-common/llm';
import {
    IDetectedReference,
    IFileReference,
    IPromptReferenceSyncError,
} from '../interfaces/promptExternalReference.interface';

export const PROMPT_CONTEXT_ENGINE_SERVICE_TOKEN =
    'PROMPT_CONTEXT_ENGINE_SERVICE_TOKEN';

export interface IPromptContextEngineService {
    detectAndResolveReferences(params: {
        promptText: string;
        repositoryId: string;
        repositoryName: string;
        organizationAndTeamData: OrganizationAndTeamData;
        context?: 'rule' | 'instruction' | 'prompt';
        byokConfig?: BYOKConfig;
    }): Promise<{
        references: IFileReference[];
        syncErrors?: IPromptReferenceSyncError[];
    }>;

    detectReferences(params: {
        promptText: string;
        context?: 'rule' | 'instruction' | 'prompt';
        byokConfig?: BYOKConfig;
        organizationAndTeamData: OrganizationAndTeamData;
    }): Promise<IDetectedReference[]>;

    calculatePromptHash(promptText: string): string;
}

