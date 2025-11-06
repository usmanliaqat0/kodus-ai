import { Inject, Injectable } from '@nestjs/common';
import {
    IParametersService,
    PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/parameters/contracts/parameters.service.contract';
import { ParametersEntity } from '@/core/domain/parameters/entities/parameters.entity';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import {
    IIntegrationConfigService,
    INTEGRATION_CONFIG_SERVICE_TOKEN,
} from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { IntegrationConfigKey } from '@/shared/domain/enums/Integration-config-key.enum';
import {
    CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN,
    ICodeReviewSettingsLogService,
} from '@/ee/codeReviewSettingsLog/domain/codeReviewSettingsLog/contracts/codeReviewSettingsLog.service.contract';
import { REQUEST } from '@nestjs/core';
import {
    ActionType,
    ConfigLevel,
} from '@/config/types/general/codeReviewSettingsLog.type';
import {
    ICodeRepository,
    CodeReviewParameter,
    DirectoryCodeReviewConfig,
    RepositoryCodeReviewConfig,
} from '@/config/types/general/codeReviewConfig.type';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { UserRequest } from '@/config/types/http/user-request.type';
import { DeepPartial } from 'typeorm';
import { getDefaultKodusConfigFile } from '@/shared/utils/validateCodeReviewConfigFile';
import { produce } from 'immer';
import { deepDifference, deepMerge } from '@/shared/utils/deep';
import { CreateOrUpdateCodeReviewParameterDto } from '@/core/infrastructure/http/dtos/create-or-update-code-review-parameter.dto';
import { v4 as uuidv4 } from 'uuid';
import {
    IPromptExternalReferenceManagerService,
    PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN,
} from '@/core/domain/prompts/contracts/promptExternalReferenceManager.contract';
import { PromptSourceType } from '@/core/domain/prompts/interfaces/promptExternalReference.interface';
import {
    IGetAdditionalInfoHelper,
    GET_ADDITIONAL_INFO_HELPER_TOKEN,
} from '@/shared/domain/contracts/getAdditionalInfo.helper.contract';

@Injectable()
export class UpdateOrCreateCodeReviewParameterUseCase {
    constructor(
        @Inject(PARAMETERS_SERVICE_TOKEN)
        private readonly parametersService: IParametersService,

        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IIntegrationConfigService,

        @Inject(CODE_REVIEW_SETTINGS_LOG_SERVICE_TOKEN)
        private readonly codeReviewSettingsLogService: ICodeReviewSettingsLogService,

        @Inject(REQUEST)
        private readonly request: UserRequest,

        private readonly logger: PinoLoggerService,

        private readonly authorizationService: AuthorizationService,

        @Inject(PROMPT_EXTERNAL_REFERENCE_MANAGER_SERVICE_TOKEN)
        private readonly promptReferenceManager: IPromptExternalReferenceManagerService,

        @Inject(GET_ADDITIONAL_INFO_HELPER_TOKEN)
        private readonly getAdditionalInfoHelper: IGetAdditionalInfoHelper,
    ) {}

    async execute(
        body: CreateOrUpdateCodeReviewParameterDto,
    ): Promise<ParametersEntity<ParametersKey.CODE_REVIEW_CONFIG> | boolean> {
        try {
            const { organizationAndTeamData, configValue, repositoryId } = body;
            let directoryPath = body.directoryPath;
            let directoryId = body.directoryId;

            if (directoryPath === '/' || directoryPath === '') {
                directoryPath = undefined;
            }

            if (!organizationAndTeamData.organizationId) {
                organizationAndTeamData.organizationId =
                    this.request.user.organization.uuid;
            }

            await this.authorizationService.ensure({
                user: this.request.user,
                action: Action.Create,
                resource: ResourceType.CodeReviewSettings,
                repoIds: [repositoryId],
            });

            const codeReviewConfigs = await this.getCodeReviewConfigs(
                organizationAndTeamData,
            );
            const codeRepositories = await this.getFormattedRepositories(
                organizationAndTeamData,
            );

            const filteredRepositoryInfo =
                this.filterRepositoryInfo(codeRepositories);

            if (!codeReviewConfigs || !codeReviewConfigs.configs) {
                return await this.createNewGlobalConfig(
                    organizationAndTeamData,
                    configValue,
                    filteredRepositoryInfo,
                );
            }

            this.mergeRepositories(codeReviewConfigs, filteredRepositoryInfo);

            if (directoryPath) {
                if (directoryId) {
                    throw new Error(
                        'Directory ID should not be provided when directory path is provided',
                    );
                }

                if (!repositoryId) {
                    throw new Error(
                        'Repository ID is required when directory path is provided',
                    );
                }

                const repoIndex = codeReviewConfigs.repositories.findIndex(
                    (r) => r.id === repositoryId,
                );

                if (repoIndex === -1) {
                    throw new Error('Repository configuration not found');
                }

                const targetRepo = codeReviewConfigs.repositories[repoIndex];
                if (!targetRepo.directories) {
                    targetRepo.directories = [];
                }

                const existingDirectory = targetRepo.directories.find(
                    (d) => d.path === directoryPath,
                );

                if (existingDirectory) {
                    directoryId = existingDirectory.id;
                } else {
                    const segments = directoryPath.split('/');
                    const name = segments[segments.length - 1];

                    const newDirectory: DirectoryCodeReviewConfig = {
                        id: uuidv4(),
                        name,
                        path: directoryPath,
                        isSelected: true,
                        configs: {},
                    };

                    targetRepo.directories.push(newDirectory);
                    directoryId = newDirectory.id;
                }
            }

            const result = await this.handleConfigUpdate(
                organizationAndTeamData,
                codeReviewConfigs,
                configValue,
                repositoryId,
                directoryId,
            );

            // Process external references in background
            this.processExternalReferencesAsync(
                configValue,
                organizationAndTeamData,
                repositoryId,
                directoryId,
            ).catch((error) => {
                this.logger.error({
                    message: 'Background reference processing failed',
                    context: UpdateOrCreateCodeReviewParameterUseCase.name,
                    error,
                    metadata: {
                        organizationAndTeamData,
                        repositoryId,
                        directoryId,
                    },
                });
            });

            return result;
        } catch (error) {
            this.handleError(error, body);
            throw new Error('Error creating or updating parameters');
        }
    }

    private async getCodeReviewConfigs(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<CodeReviewParameter> {
        const codeReviewConfig = await this.parametersService.findByKey(
            ParametersKey.CODE_REVIEW_CONFIG,
            organizationAndTeamData,
        );

        return codeReviewConfig?.configValue;
    }

    private async getFormattedRepositories(
        organizationAndTeamData: OrganizationAndTeamData,
    ) {
        return await this.integrationConfigService.findIntegrationConfigFormatted<
            ICodeRepository[]
        >(IntegrationConfigKey.REPOSITORIES, organizationAndTeamData);
    }

    private filterRepositoryInfo(codeRepositories: ICodeRepository[]) {
        return codeRepositories.map((repository) => ({
            id: repository.id,
            name: repository.name,
            isSelected: false,
            directories: repository.directories ?? [],
            configs: {},
        }));
    }

    private async createNewGlobalConfig(
        organizationAndTeamData: OrganizationAndTeamData,
        configValue: CreateOrUpdateCodeReviewParameterDto['configValue'],
        filteredRepositoryInfo: RepositoryCodeReviewConfig[],
    ) {
        const defaultConfig = getDefaultKodusConfigFile();

        const updatedConfigValue = deepDifference(defaultConfig, configValue);

        const updatedConfig = {
            id: 'global',
            name: 'Global',
            isSelected: true,
            configs: updatedConfigValue,
            repositories: filteredRepositoryInfo,
        } as CodeReviewParameter;

        return await this.parametersService.createOrUpdateConfig(
            ParametersKey.CODE_REVIEW_CONFIG,
            updatedConfig,
            organizationAndTeamData,
        );
    }

    private mergeRepositories(
        codeReviewConfigs: CodeReviewParameter,
        filteredRepositoryInfo: RepositoryCodeReviewConfig[],
    ) {
        const existingRepoIds = new Set(
            (codeReviewConfigs.repositories || []).map((repo) => repo.id),
        );

        const updatedRepositories = [
            ...(codeReviewConfigs.repositories || []),
            ...filteredRepositoryInfo.filter(
                (repo) => !existingRepoIds.has(repo.id),
            ),
        ];

        codeReviewConfigs.repositories = updatedRepositories;
    }

    private async handleConfigUpdate(
        organizationAndTeamData: OrganizationAndTeamData,
        codeReviewConfigs: CodeReviewParameter,
        newConfigValue: CreateOrUpdateCodeReviewParameterDto['configValue'],
        repositoryId?: string,
        directoryId?: string,
    ) {
        const resolver = new ConfigResolver(codeReviewConfigs);

        const parentConfig = await resolver.getResolvedParentConfig(
            repositoryId,
            directoryId,
        );

        let oldConfig: CreateOrUpdateCodeReviewParameterDto['configValue'] = {};
        let level: ConfigLevel;
        let repository: RepositoryCodeReviewConfig | undefined;
        let directory: DirectoryCodeReviewConfig | undefined;

        if (directoryId && repositoryId) {
            level = ConfigLevel.DIRECTORY;
            repository = resolver.findRepository(repositoryId);
            directory = resolver.findDirectory(repository, directoryId);
            oldConfig = directory.configs ?? {};
        } else if (repositoryId) {
            level = ConfigLevel.REPOSITORY;
            repository = resolver.findRepository(repositoryId);
            oldConfig = repository.configs ?? {};
        } else {
            level = ConfigLevel.GLOBAL;
            oldConfig = codeReviewConfigs.configs ?? {};
        }

        const newResolvedConfig = deepMerge(
            parentConfig,
            oldConfig,
            newConfigValue,
        );

        const newDelta = deepDifference(parentConfig, newResolvedConfig);

        const updater = resolver.createUpdater(
            newDelta,
            repositoryId,
            directoryId,
        );

        const updatedCodeReviewConfigValue = produce(
            codeReviewConfigs,
            updater,
        );

        await this.parametersService.createOrUpdateConfig(
            ParametersKey.CODE_REVIEW_CONFIG,
            updatedCodeReviewConfigValue,
            organizationAndTeamData,
        );

        await this.logConfigUpdate({
            organizationAndTeamData,
            oldConfig,
            newConfig: newConfigValue,
            level,
            sourceFunctionName: `handleConfigUpdate[${level}]`,
            repository,
            directory,
        });

        return true;
    }

    private async logConfigUpdate(options: {
        organizationAndTeamData: OrganizationAndTeamData;
        oldConfig: CreateOrUpdateCodeReviewParameterDto['configValue'];
        newConfig: CreateOrUpdateCodeReviewParameterDto['configValue'];
        level: ConfigLevel;
        sourceFunctionName: string;
        repository?: RepositoryCodeReviewConfig;
        directory?: DirectoryCodeReviewConfig;
    }) {
        const {
            organizationAndTeamData,
            oldConfig,
            newConfig,
            level,
            sourceFunctionName,
            repository,
            directory,
        } = options;

        try {
            const logPayload: any = {
                organizationAndTeamData,
                userInfo: {
                    userId: this.request.user.uuid,
                    userEmail: this.request.user.email,
                },
                oldConfig,
                newConfig,
                actionType: ActionType.EDIT,
                configLevel: level,
            };

            if (repository) {
                logPayload.repository = {
                    id: repository.id,
                    name: repository.name,
                };
            }
            if (directory) {
                logPayload.directory = {
                    id: directory.id,
                    path: directory.path,
                };
            }

            await this.codeReviewSettingsLogService.registerCodeReviewConfigLog(
                logPayload,
            );
        } catch (error) {
            this.logger.error({
                message: `Error saving code review settings log for ${level.toLowerCase()} level`,
                error: error,
                context: UpdateOrCreateCodeReviewParameterUseCase.name,
                metadata: {
                    organizationAndTeamData: organizationAndTeamData,
                    functionName: sourceFunctionName,
                },
            });
        }
    }

    private handleError(
        error: any,
        body: CreateOrUpdateCodeReviewParameterDto,
    ) {
        this.logger.error({
            message:
                'Error creating or updating code review configuration parameter',
            context: UpdateOrCreateCodeReviewParameterUseCase.name,
            error: error,
            metadata: {
                parametersKey: ParametersKey.CODE_REVIEW_CONFIG,
                configValue: body.configValue,
                organizationAndTeamData: body.organizationAndTeamData,
            },
        });
    }

    private async processExternalReferencesAsync(
        configValue: CreateOrUpdateCodeReviewParameterDto['configValue'],
        organizationAndTeamData: OrganizationAndTeamData,
        repositoryId?: string,
        directoryId?: string,
    ): Promise<void> {
        const configKey = this.promptReferenceManager.buildConfigKey(
            organizationAndTeamData.organizationId,
            repositoryId || 'global',
            directoryId,
        );

        let repositoryName: string;
        if (repositoryId && repositoryId !== 'global') {
            try {
                repositoryName =
                    await this.getAdditionalInfoHelper.getRepositoryNameByOrganizationAndRepository(
                        organizationAndTeamData.organizationId,
                        repositoryId,
                    );
            } catch (error) {
                this.logger.warn({
                    message:
                        'Failed to resolve repository name, using ID as fallback',
                    context: UpdateOrCreateCodeReviewParameterUseCase.name,
                    error,
                    metadata: {
                        organizationAndTeamData,
                        repositoryId,
                        directoryId,
                    },
                });
                repositoryName = repositoryId;
            }
        } else {
            repositoryName = 'global';
        }

        const prompts = this.extractPromptsFromConfig(configValue);

        await Promise.all(
            prompts.map((promptData) =>
                this.promptReferenceManager.createOrUpdatePendingReference({
                    promptText: promptData.text,
                    configKey,
                    sourceType: promptData.sourceType,
                    organizationId: organizationAndTeamData.organizationId,
                    repositoryId: repositoryId || 'global',
                    repositoryName,
                    organizationAndTeamData,
                    directoryId,
                }),
            ),
        );

        setImmediate(async () => {
            try {
                await Promise.all(
                    prompts.map((promptData) =>
                        this.promptReferenceManager.processReferencesInBackground(
                            {
                                promptText: promptData.text,
                                configKey,
                                sourceType: promptData.sourceType,
                                organizationId:
                                    organizationAndTeamData.organizationId,
                                repositoryId: repositoryId || 'global',
                                repositoryName,
                                directoryId,
                                organizationAndTeamData,
                                context: 'instruction',
                            },
                        ),
                    ),
                );

                this.logger.log({
                    message:
                        'Successfully processed external references in background',
                    context: UpdateOrCreateCodeReviewParameterUseCase.name,
                    metadata: {
                        organizationAndTeamData,
                        repositoryId,
                        directoryId,
                        promptsProcessed: prompts.length,
                    },
                });
            } catch (error) {
                this.logger.error({
                    message: 'Failed to process external references',
                    context: UpdateOrCreateCodeReviewParameterUseCase.name,
                    error,
                    metadata: {
                        organizationAndTeamData,
                        repositoryId,
                        directoryId,
                    },
                });
            }
        });
    }

    private extractPromptsFromConfig(
        configValue: CreateOrUpdateCodeReviewParameterDto['configValue'],
    ): Array<{ text: string; sourceType: PromptSourceType }> {
        const prompts: Array<{ text: string; sourceType: PromptSourceType }> =
            [];

        if (configValue?.summary?.customInstructions) {
            prompts.push({
                text: configValue.summary.customInstructions,
                sourceType: PromptSourceType.CUSTOM_INSTRUCTION,
            });
        }

        if (configValue?.v2PromptOverrides?.categories?.descriptions) {
            const { bug, performance, security } =
                configValue.v2PromptOverrides.categories.descriptions;

            if (bug) {
                prompts.push({
                    text: bug,
                    sourceType: PromptSourceType.CATEGORY_BUG,
                });
            }
            if (performance) {
                prompts.push({
                    text: performance,
                    sourceType: PromptSourceType.CATEGORY_PERFORMANCE,
                });
            }
            if (security) {
                prompts.push({
                    text: security,
                    sourceType: PromptSourceType.CATEGORY_SECURITY,
                });
            }
        }

        if (configValue?.v2PromptOverrides?.severity?.flags) {
            const { critical, high, medium, low } =
                configValue.v2PromptOverrides.severity.flags;

            if (critical) {
                prompts.push({
                    text: critical,
                    sourceType: PromptSourceType.SEVERITY_CRITICAL,
                });
            }
            if (high) {
                prompts.push({
                    text: high,
                    sourceType: PromptSourceType.SEVERITY_HIGH,
                });
            }
            if (medium) {
                prompts.push({
                    text: medium,
                    sourceType: PromptSourceType.SEVERITY_MEDIUM,
                });
            }
            if (low) {
                prompts.push({
                    text: low,
                    sourceType: PromptSourceType.SEVERITY_LOW,
                });
            }
        }

        if (configValue?.v2PromptOverrides?.generation?.main) {
            prompts.push({
                text: configValue.v2PromptOverrides.generation.main,
                sourceType: PromptSourceType.GENERATION_MAIN,
            });
        }

        return prompts;
    }
}

class ConfigResolver {
    private readonly defaultConfig = getDefaultKodusConfigFile();

    constructor(private readonly codeReviewConfigs: CodeReviewParameter) {}

    public findRepository(repositoryId: string): RepositoryCodeReviewConfig {
        const repo = this.codeReviewConfigs.repositories.find(
            (r) => r.id === repositoryId,
        );
        if (!repo) {
            throw new Error('Repository configuration not found');
        }
        return repo;
    }

    public findDirectory(
        repository: RepositoryCodeReviewConfig,
        directoryId: string,
    ): DirectoryCodeReviewConfig {
        const dir = repository.directories?.find((d) => d.id === directoryId);
        if (!dir) {
            throw new Error('Directory configuration not found');
        }
        return dir;
    }

    public async getResolvedParentConfig(
        repositoryId?: string,
        directoryId?: string,
    ): Promise<CreateOrUpdateCodeReviewParameterDto['configValue']> {
        if (directoryId && repositoryId) {
            return this.getResolvedRepositoryConfig(repositoryId);
        }
        if (repositoryId) {
            return this.getResolvedGlobalConfig();
        }

        return this
            .defaultConfig as CreateOrUpdateCodeReviewParameterDto['configValue'];
    }

    public createUpdater(
        newDelta: CreateOrUpdateCodeReviewParameterDto['configValue'],
        repositoryId?: string,
        directoryId?: string,
    ): (draft: CodeReviewParameter) => void {
        return (draft) => {
            if (directoryId && repositoryId) {
                const repoIndex = draft.repositories.findIndex(
                    (r) => r.id === repositoryId,
                );

                const dirIndex = draft.repositories[
                    repoIndex
                ].directories.findIndex((d) => d.id === directoryId);

                draft.repositories[repoIndex].isSelected = true;

                draft.repositories[repoIndex].directories[dirIndex].configs =
                    newDelta;

                draft.repositories[repoIndex].directories[dirIndex].isSelected =
                    true;
            } else if (repositoryId) {
                const repoIndex = draft.repositories.findIndex(
                    (r) => r.id === repositoryId,
                );

                draft.repositories[repoIndex].configs = newDelta;

                draft.repositories[repoIndex].isSelected = true;
            } else {
                draft.configs = newDelta;
            }
        };
    }

    private getResolvedGlobalConfig(): CreateOrUpdateCodeReviewParameterDto['configValue'] {
        return deepMerge(
            this
                .defaultConfig as CreateOrUpdateCodeReviewParameterDto['configValue'],
            this.codeReviewConfigs.configs ?? {},
        );
    }

    private async getResolvedRepositoryConfig(
        repositoryId: string,
    ): Promise<CreateOrUpdateCodeReviewParameterDto['configValue']> {
        const repository = this.findRepository(repositoryId);
        const resolvedGlobal = this.getResolvedGlobalConfig();

        return deepMerge(resolvedGlobal, repository.configs ?? {});
    }
}
