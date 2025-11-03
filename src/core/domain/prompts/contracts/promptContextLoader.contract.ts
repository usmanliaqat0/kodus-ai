import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PromptExternalReferenceEntity } from '../entities/promptExternalReference.entity';
import { IExternalPromptContext } from '../interfaces/promptExternalReference.interface';

export const PROMPT_CONTEXT_LOADER_SERVICE_TOKEN = 'PROMPT_CONTEXT_LOADER_SERVICE_TOKEN';

export interface LoadContextParams {
    organizationAndTeamData: OrganizationAndTeamData;
    repository: {
        id: string;
        name: string;
    };
    pullRequest: {
        head?: {
            sha: string;
        };
        number: number;
        [key: string]: unknown;
    };
    allReferences: PromptExternalReferenceEntity[];
}

export interface IPromptContextLoaderService {
    loadExternalContext(params: LoadContextParams): Promise<IExternalPromptContext>;
}

