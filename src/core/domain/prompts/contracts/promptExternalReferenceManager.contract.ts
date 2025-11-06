import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PromptExternalReferenceEntity } from '../entities/promptExternalReference.entity';
import { PromptSourceType } from '../interfaces/promptExternalReference.interface';

export const PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN =
    'PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN';

export interface IPromptExternalReferenceManagerService {
    buildConfigKey(
        organizationAndTeamData: OrganizationAndTeamData,
        repositoryId: string,
        directoryId?: string,
    ): string;

    buildConfigKeysHierarchy(
        organizationAndTeamData: OrganizationAndTeamData,
        repositoryId: string,
        directoryId?: string,
    ): string[];

    findByConfigKeys(
        configKeys: string[],
    ): Promise<PromptExternalReferenceEntity[]>;

    findByConfigKey(
        configKey: string,
        sourceType: PromptSourceType,
    ): Promise<PromptExternalReferenceEntity | null>;

    getReference(
        configKey: string,
        sourceType: PromptSourceType,
    ): Promise<PromptExternalReferenceEntity | null>;

    getMultipleReferences(
        configKey: string,
        sourceTypes: PromptSourceType[],
    ): Promise<Map<PromptSourceType, PromptExternalReferenceEntity>>;
}
