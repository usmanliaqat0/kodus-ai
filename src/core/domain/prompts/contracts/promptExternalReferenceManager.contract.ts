import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { BYOKConfig } from '@kodus/kodus-common/llm';
import { PromptExternalReferenceEntity } from '../entities/promptExternalReference.entity';
import { PromptSourceType } from '../interfaces/promptExternalReference.interface';

export const PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN =
    'PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN';

export interface IPromptExternalReferenceManagerService {
    processPromptReferences(params: {
        promptText: string;
        configKey: string;
        sourceType: PromptSourceType;
        organizationId: string;
        repositoryId: string;
        repositoryName: string;
        directoryId?: string;
        kodyRuleId?: string;
        organizationAndTeamData: OrganizationAndTeamData;
        context?: 'rule' | 'instruction' | 'prompt';
        byokConfig?: BYOKConfig;
    }): Promise<{
        entity: PromptExternalReferenceEntity | null;
        wasProcessed: boolean;
    }>;

    buildConfigKey(
        organizationId: string,
        repositoryId: string,
        directoryId?: string,
    ): string;

    buildConfigKeysHierarchy(
        organizationId: string,
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

    delete(uuid: string): Promise<boolean>;

    createOrUpdatePendingReference(params: {
        promptText: string;
        configKey: string;
        sourceType: PromptSourceType;
        organizationId: string;
        repositoryId: string;
        repositoryName: string;
        organizationAndTeamData: OrganizationAndTeamData;
        directoryId?: string;
        kodyRuleId?: string;
    }): Promise<PromptExternalReferenceEntity | null>;

    processReferencesInBackground(params: {
        promptText: string;
        configKey: string;
        sourceType: PromptSourceType;
        organizationId: string;
        repositoryId: string;
        repositoryName: string;
        directoryId?: string;
        kodyRuleId?: string;
        organizationAndTeamData: OrganizationAndTeamData;
        context?: 'rule' | 'instruction' | 'prompt';
        byokConfig?: BYOKConfig;
    }): Promise<void>;

    getReference(
        configKey: string,
        sourceType: PromptSourceType,
    ): Promise<PromptExternalReferenceEntity | null>;

    getMultipleReferences(
        configKey: string,
        sourceTypes: PromptSourceType[],
    ): Promise<Map<PromptSourceType, PromptExternalReferenceEntity>>;
}
