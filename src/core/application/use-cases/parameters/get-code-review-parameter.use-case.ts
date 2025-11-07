import { CodeReviewConfigWithoutLLMProvider } from '@/config/types/general/codeReview.type';
import {
    FormattedCodeReviewConfig,
    FormattedConfigLevel,
    FormattedGlobalCodeReviewConfig,
    IFormattedConfigProperty,
} from '@/config/types/general/codeReviewConfig.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    CODE_BASE_CONFIG_SERVICE_TOKEN,
    ICodeBaseConfigService,
} from '@/core/domain/codeBase/contracts/CodeBaseConfigService.contract';
import {
    PARAMETERS_SERVICE_TOKEN,
    IParametersService,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { IParameters } from '@/core/domain/parameters/interfaces/parameters.interface';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { getDefaultKodusConfigFile } from '@/shared/utils/validateCodeReviewConfigFile';
import { Inject, Injectable } from '@nestjs/common';
import { DeepPartial } from 'typeorm';
import {
    IPromptExternalReferenceManagerService,
    PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN,
} from '@/core/domain/prompts/contracts/promptExternalReferenceManager.contract';
import { PromptSourceType } from '@/core/domain/prompts/interfaces/promptExternalReference.interface';

@Injectable()
export class GetCodeReviewParameterUseCase {
    constructor(
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,

        @Inject(CODE_BASE_CONFIG_SERVICE_TOKEN)
        private readonly codeBaseConfigService: ICodeBaseConfigService,

        private readonly authorizationService: AuthorizationService,

        @Inject(PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN)
        private readonly promptReferenceManager: IPromptExternalReferenceManagerService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(user: Partial<IUser>, teamId: string) {
        try {
            if (!user?.organization?.uuid) {
                throw new Error('User organization data is missing');
            }

            if (!teamId) {
                throw new Error('Team ID is required');
            }

            const organizationAndTeamData = {
                organizationId: user.organization.uuid,
                teamId: teamId,
            };

            const parametersEntity = await this.parametersService.findByKey(
                ParametersKey.CODE_REVIEW_CONFIG,
                organizationAndTeamData,
            );

            if (!parametersEntity) {
                throw new Error('Code review parameters not found');
            }

            const parameters = parametersEntity.toObject();

            const filteredRepositories = [];
            for (const repo of parameters.configValue.repositories) {
                // if (!repo.isSelected) continue;

                const hasPermission = await this.authorizationService.check({
                    user,
                    action: Action.Read,
                    resource: ResourceType.CodeReviewSettings,
                    repoIds: [repo.id],
                });

                if (hasPermission) {
                    filteredRepositories.push(repo);
                }
            }

            const hasPermissionParameters = {
                ...parameters,
                configValue: {
                    ...parameters.configValue,
                    repositories: filteredRepositories,
                },
            };

            const formattedConfigValue =
                await this.getCodeReviewConfigFormatted(
                    organizationAndTeamData,
                    hasPermissionParameters.configValue,
                );

            /**
             * TEMPORARY LOGIC: Show/hide code review version toggle based on user registration date
             *
             * Purpose: Gradually migrate users from legacy to v2 engine
             * - Users registered BEFORE 2025-09-11: Can see version toggle (legacy + v2)
             * - Users registered ON/AFTER 2025-09-11: Only see v2 (no toggle)
             *
             * This logic should be REMOVED after all clients migrate to v2 engine
             * TODO: Remove this temporary logic after client migration completion
             */
            const cutoffYear = 2025;
            const cutoffMonth = 8; // September (0-indexed)
            const cutoffDay = 11;

            const paramYear =
                hasPermissionParameters.createdAt.getUTCFullYear();
            const paramMonth = hasPermissionParameters.createdAt.getUTCMonth();
            const paramDay = hasPermissionParameters.createdAt.getUTCDate();

            const showToggleCodeReviewVersion =
                paramYear < cutoffYear ||
                (paramYear === cutoffYear && paramMonth < cutoffMonth) ||
                (paramYear === cutoffYear &&
                    paramMonth === cutoffMonth &&
                    paramDay < cutoffDay);

            return {
                ...hasPermissionParameters,
                configValue: {
                    ...formattedConfigValue,
                    configs: {
                        ...formattedConfigValue.configs,
                        showToggleCodeReviewVersion,
                    },
                },
            };
        } catch (error) {
            this.logger.error({
                message: 'Error fetching code review parameters',
                context: GetCodeReviewParameterUseCase.name,
                error: error,
                metadata: { user, teamId },
            });
            throw error;
        }
    }

    private async getCodeReviewConfigFormatted(
        organizationAndTeamData: OrganizationAndTeamData,
        configValue: IParameters<ParametersKey.CODE_REVIEW_CONFIG>['configValue'],
    ): Promise<FormattedGlobalCodeReviewConfig> {
        const defaultConfig = getDefaultKodusConfigFile();
        const formattedDefaultConfig = this.formatDefaultConfig(defaultConfig);

        let formattedGlobalConfig = this.formatLevel(
            formattedDefaultConfig,
            configValue.configs,
            FormattedConfigLevel.GLOBAL,
        );

        // Buscar e adicionar referências externas do nível global
        const globalConfigKey = this.promptReferenceManager.buildConfigKey(
            organizationAndTeamData.organizationId,
            'global',
        );
        formattedGlobalConfig = await this.enrichConfigWithExternalReferences(
            formattedGlobalConfig,
            globalConfigKey,
        );

        const formattedRepositories = [];

        for (const repo of configValue.repositories || []) {
            const repository = {
                id: repo.id,
                name: repo.name,
            };

            const repoFile =
                await this.codeBaseConfigService.getKodusConfigFile({
                    organizationAndTeamData,
                    repository,
                    overrideConfig:
                        repo.configs?.kodusConfigFileOverridesWebPreferences ??
                        false,
                });

            let formattedRepoConfig = this.formatLevel(
                formattedGlobalConfig,
                repo.configs,
                FormattedConfigLevel.REPOSITORY,
            );

            let formattedRepoFileConfig = this.formatLevel(
                formattedRepoConfig,
                repoFile,
                FormattedConfigLevel.REPOSITORY_FILE,
            );

            // Buscar e adicionar referências externas do nível repositório
            const repoConfigKey = this.promptReferenceManager.buildConfigKey(
                organizationAndTeamData.organizationId,
                repo.id,
            );
            formattedRepoFileConfig = await this.enrichConfigWithExternalReferences(
                formattedRepoFileConfig,
                repoConfigKey,
            );

            const formattedDirectories = [];

            for (const dir of repo.directories || []) {
                const directoryFile =
                    await this.codeBaseConfigService.getKodusConfigFile({
                        organizationAndTeamData,
                        repository,
                        directoryPath: dir.path,
                        overrideConfig:
                            dir.configs
                                ?.kodusConfigFileOverridesWebPreferences ??
                            repo.configs
                                ?.kodusConfigFileOverridesWebPreferences ??
                            false,
                    });

                let formattedDirConfig = this.formatLevel(
                    formattedRepoFileConfig,
                    dir.configs,
                    FormattedConfigLevel.DIRECTORY,
                );

                let formattedDirFileConfig = this.formatLevel(
                    formattedDirConfig,
                    directoryFile,
                    FormattedConfigLevel.DIRECTORY_FILE,
                );

                // Buscar e adicionar referências externas do nível diretório
                const dirConfigKey = this.promptReferenceManager.buildConfigKey(
                    organizationAndTeamData.organizationId,
                    repo.id,
                    dir.id,
                );
                formattedDirFileConfig = await this.enrichConfigWithExternalReferences(
                    formattedDirFileConfig,
                    dirConfigKey,
                );

                formattedDirectories.push({
                    ...dir,
                    configs: formattedDirFileConfig,
                });
            }

            formattedRepositories.push({
                ...repo,
                configs: formattedRepoFileConfig,
                directories: formattedDirectories,
            });
        }

        return {
            ...configValue,
            configs: formattedGlobalConfig as any, // TODO: remove this 'any' once migration is done
            repositories: formattedRepositories,
        };
    }

    private formatDefaultConfig(config: object): FormattedCodeReviewConfig {
        const formatted = {};
        for (const key in config) {
            if (Object.prototype.hasOwnProperty.call(config, key)) {
                const value = config[key];
                if (
                    typeof value === 'object' &&
                    value !== null &&
                    !Array.isArray(value)
                ) {
                    formatted[key] = this.formatDefaultConfig(value);
                } else {
                    formatted[key] = {
                        value,
                        level: FormattedConfigLevel.DEFAULT,
                    };
                }
            }
        }
        return formatted as FormattedCodeReviewConfig;
    }

    private formatLevel(
        formattedParent: FormattedCodeReviewConfig,
        childDelta: DeepPartial<CodeReviewConfigWithoutLLMProvider> | undefined,
        childLevel: FormattedConfigLevel,
    ): FormattedCodeReviewConfig {
        if (!childDelta) {
            return formattedParent;
        }

        const formattedChild = { ...formattedParent };

        for (const key in childDelta) {
            if (Object.prototype.hasOwnProperty.call(childDelta, key)) {
                const childValue = childDelta[key];
                const parentNode = formattedParent[key];

                if (
                    typeof childValue === 'object' &&
                    childValue !== null &&
                    !Array.isArray(childValue) &&
                    parentNode
                ) {
                    formattedChild[key] = this.formatLevel(
                        parentNode,
                        childValue,
                        childLevel,
                    );
                } else {
                    formattedChild[key] = {
                        value: childValue,
                        level: childLevel,
                        overriddenValue: (
                            parentNode as IFormattedConfigProperty<any>
                        )?.value,
                        overriddenLevel: (
                            parentNode as IFormattedConfigProperty<any>
                        )?.level,
                    };
                }
            }
        }
        return formattedChild;
    }

    private async enrichConfigWithExternalReferences(
        config: FormattedCodeReviewConfig,
        configKey: string,
    ): Promise<FormattedCodeReviewConfig> {
        const enriched = structuredClone(config);

        // Enriquecer summary.customInstructions
        if (enriched.summary?.customInstructions) {
            const ref = await this.promptReferenceManager.getReference(
                configKey,
                PromptSourceType.CUSTOM_INSTRUCTION,
            );
            if (ref) {
                enriched.summary.customInstructions = {
                    ...enriched.summary.customInstructions,
                    externalReferences: {
                        references: ref.references,
                        syncErrors: ref.syncErrors || [],
                        processingStatus: ref.processingStatus,
                        lastProcessedAt: ref.lastProcessedAt,
                    },
                };
            }
        }

        // Enriquecer v2PromptOverrides
        if (enriched.v2PromptOverrides) {
            const categories = ['bug', 'performance', 'security'] as const;
            const severities = ['critical', 'high', 'medium', 'low'] as const;

            const sourceTypesToFetch: PromptSourceType[] = [];

            if (enriched.v2PromptOverrides.categories?.descriptions) {
                categories
                    .filter(category => enriched.v2PromptOverrides.categories.descriptions[category])
                    .forEach(category => {
                        sourceTypesToFetch.push(`category_${category}` as PromptSourceType);
                    });
            }

            if (enriched.v2PromptOverrides.severity?.flags) {
                severities
                    .filter(severity => enriched.v2PromptOverrides.severity.flags[severity])
                    .forEach(severity => {
                        sourceTypesToFetch.push(`severity_${severity}` as PromptSourceType);
                    });
            }

            if (enriched.v2PromptOverrides.generation?.main) {
                sourceTypesToFetch.push(PromptSourceType.GENERATION_MAIN);
            }

            const referencesMap = await this.promptReferenceManager.getMultipleReferences(
                configKey,
                sourceTypesToFetch,
            );

            if (enriched.v2PromptOverrides.categories?.descriptions) {
                for (const category of categories) {
                    if (enriched.v2PromptOverrides.categories.descriptions[category]) {
                        const ref = referencesMap.get(`category_${category}` as PromptSourceType);
                        if (ref) {
                            enriched.v2PromptOverrides.categories.descriptions[category] = {
                                ...enriched.v2PromptOverrides.categories.descriptions[category],
                                externalReferences: {
                                    references: ref.references,
                                    syncErrors: ref.syncErrors || [],
                                    processingStatus: ref.processingStatus,
                                    lastProcessedAt: ref.lastProcessedAt,
                                },
                            };
                        }
                    }
                }
            }

            if (enriched.v2PromptOverrides.severity?.flags) {
                for (const severity of severities) {
                    if (enriched.v2PromptOverrides.severity.flags[severity]) {
                        const ref = referencesMap.get(`severity_${severity}` as PromptSourceType);
                        if (ref) {
                            enriched.v2PromptOverrides.severity.flags[severity] = {
                                ...enriched.v2PromptOverrides.severity.flags[severity],
                                externalReferences: {
                                    references: ref.references,
                                    syncErrors: ref.syncErrors || [],
                                    processingStatus: ref.processingStatus,
                                    lastProcessedAt: ref.lastProcessedAt,
                                },
                            };
                        }
                    }
                }
            }

            if (enriched.v2PromptOverrides.generation?.main) {
                const ref = referencesMap.get(PromptSourceType.GENERATION_MAIN);
                if (ref) {
                    enriched.v2PromptOverrides.generation.main = {
                        ...enriched.v2PromptOverrides.generation.main,
                        externalReferences: {
                            references: ref.references,
                            syncErrors: ref.syncErrors || [],
                            processingStatus: ref.processingStatus,
                            lastProcessedAt: ref.lastProcessedAt,
                        },
                    };
                }
            }
        }

        return enriched;
    }
}
