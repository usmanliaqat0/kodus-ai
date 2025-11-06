import { createHash } from 'crypto';

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
import { getDefaultKodusConfigFile } from '@/shared/utils/validateCodeReviewConfigFile';
import { produce } from 'immer';
import { deepDifference, deepMerge } from '@/shared/utils/deep';
import { CreateOrUpdateCodeReviewParameterDto } from '@/core/infrastructure/http/dtos/create-or-update-code-review-parameter.dto';
import { v4 as uuidv4 } from 'uuid';
import {
    IPromptContextEngineService,
    PROMPT_CONTEXT_ENGINE_SERVICE_TOKEN,
} from '@/core/domain/prompts/contracts/promptContextEngine.contract';
import {
    IPromptReferenceSyncError,
    PromptReferenceErrorType,
    PromptSourceType,
} from '@/core/domain/prompts/interfaces/promptExternalReference.interface';
import {
    CONTEXT_REFERENCE_SERVICE_TOKEN,
    IContextReferenceService,
} from '@/core/domain/contextReferences/contracts/context-reference.service.contract';
import { CodeReviewVersion } from '@/config/types/general/codeReview.type';
import type {
    ContextRequirement,
    ContextRevisionScope,
    RetrievalQuery,
    ContextDependency,
} from '@context-os-core/interfaces';
import {
    CODE_REVIEW_CONTEXT_PATTERNS,
    extractDependenciesFromValue,
    pathToKey,
    resolveSourceTypeFromPath,
} from '@/core/infrastructure/adapters/services/context/code-review-context.utils';
import { convertTiptapJSONToText } from '@/core/utils/tiptap-json';
import {
    MCPToolMetadata,
    MCPToolMetadataService,
} from '@/core/infrastructure/adapters/mcp/services/mcp-tool-metadata.service';
import type { MCPServerConfig } from '@kodus/flow';

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

        @Inject(CONTEXT_REFERENCE_SERVICE_TOKEN)
        private readonly contextReferenceService: IContextReferenceService,

        @Inject(PROMPT_CONTEXT_ENGINE_SERVICE_TOKEN)
        private readonly promptContextEngine: IPromptContextEngineService,

        private readonly logger: PinoLoggerService,

        private readonly authorizationService: AuthorizationService,

        private readonly mcpToolMetadataService: MCPToolMetadataService,
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
        await this.applyContextReferenceUpdates({
            organizationAndTeamData,
            level: ConfigLevel.GLOBAL,
            newConfigValue: configValue,
            oldConfig: {},
            repositoryId: 'global',
            repositoryName: 'global',
        });

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

        await this.applyContextReferenceUpdates({
            organizationAndTeamData,
            level,
            newConfigValue,
            oldConfig,
            repositoryId: repositoryId ?? 'global',
            repositoryName: repository?.name ?? repositoryId ?? 'global',
            directoryId,
        });

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

    private async applyContextReferenceUpdates(options: {
        organizationAndTeamData: OrganizationAndTeamData;
        level: ConfigLevel;
        newConfigValue: CreateOrUpdateCodeReviewParameterDto['configValue'];
        oldConfig: CreateOrUpdateCodeReviewParameterDto['configValue'];
        repositoryId?: string;
        repositoryName?: string;
        directoryId?: string;
    }): Promise<void> {
        const {
            organizationAndTeamData,
            level,
            newConfigValue,
            oldConfig,
            repositoryId,
            repositoryName,
            directoryId,
        } = options;

        const organizationId = organizationAndTeamData.organizationId;
        if (!organizationId) {
            return;
        }

        const { summaryText, overrides, contextTarget, nestedTarget } =
            this.resolveOverridesForContext(newConfigValue);

        const baseConsumerId = this.resolveBaseConsumerId(newConfigValue);
        const mergedRequirements: ContextRequirement[] = [];

        const normalizedFields: Array<{
            path: string[];
            text: string;
            sourceType: PromptSourceType;
        }> = [];

        const resolvePromptText = (value: unknown): string => {
            if (value === undefined || value === null) {
                return '';
            }

            if (typeof value === 'string') {
                return convertTiptapJSONToText(value).trim();
            }

            if (typeof value === 'object') {
                if ('value' in value) {
                    return resolvePromptText(
                        (value as { value?: unknown }).value,
                    );
                }

                return convertTiptapJSONToText(
                    value as Record<string, unknown>,
                ).trim();
            }

            return '';
        };

        if (summaryText !== undefined) {
            const text = resolvePromptText(summaryText);
            if (text) {
                normalizedFields.push({
                    path: ['summary', 'customInstructions'],
                    text,
                    sourceType: PromptSourceType.CUSTOM_INSTRUCTION,
                });
            }
        }

        const v2 = overrides ?? {};

        if (v2.categories?.descriptions) {
            for (const [key, value] of Object.entries(
                v2.categories.descriptions,
            )) {
                const text = resolvePromptText(value);
                if (!text) continue;

                const sourceType = resolveSourceTypeFromPath([
                    'v2PromptOverrides',
                    'categories',
                    'descriptions',
                    key,
                ]);
                if (!sourceType) continue;

                normalizedFields.push({
                    path: [
                        'v2PromptOverrides',
                        'categories',
                        'descriptions',
                        key,
                    ],
                    text,
                    sourceType,
                });
            }
        }

        if (v2.severity?.flags) {
            for (const [key, value] of Object.entries(v2.severity.flags)) {
                const text = resolvePromptText(value);
                if (!text) continue;

                const sourceType = resolveSourceTypeFromPath([
                    'v2PromptOverrides',
                    'severity',
                    'flags',
                    key,
                ]);
                if (!sourceType) continue;

                normalizedFields.push({
                    path: ['v2PromptOverrides', 'severity', 'flags', key],
                    text,
                    sourceType,
                });
            }
        }

        const generationOverride = v2.generation?.main;

        if (generationOverride !== undefined) {
            const text = resolvePromptText(generationOverride);
            if (text) {
                const sourceType = resolveSourceTypeFromPath([
                    'v2PromptOverrides',
                    'generation',
                    'main',
                ]);

                if (sourceType) {
                    normalizedFields.push({
                        path: ['v2PromptOverrides', 'generation', 'main'],
                        text,
                        sourceType,
                    });
                }
            }
        }

        if (!normalizedFields.length) {
            delete contextTarget.contextReferenceId;
            delete contextTarget.contextRequirementsHash;
            if (nestedTarget) {
                delete nestedTarget.contextReferenceId;
                delete nestedTarget.contextRequirementsHash;
            }
            return;
        }

        const { connections: mcpConnections, metadata: toolMetadata } =
            await this.mcpToolMetadataService.loadMetadataForOrganization(
                organizationAndTeamData,
            );

        const { providerAliases, toolAliases, allowedTools } =
            this.buildMCPAliasStructures(mcpConnections);

        for (const field of normalizedFields) {
            const pathKey = pathToKey(field.path);
            const consumerId = `${baseConsumerId}#${pathKey}`;
            const basePromptHash = this.promptContextEngine.calculatePromptHash(
                field.text,
            );

            const { dependencies: rawMcpDependencies, markers: mcpMarkers } =
                extractDependenciesFromValue(
                    field.text,
                    CODE_REVIEW_CONTEXT_PATTERNS,
                );

            const promptNormalization = this.normalizeMCPDependencies(
                rawMcpDependencies,
                providerAliases,
                toolAliases,
                allowedTools,
                toolMetadata,
            );

            let detectionResult:
                | Awaited<
                      ReturnType<
                          IPromptContextEngineService['detectAndResolveReferences']
                      >
                  >
                | undefined;
            let detectionError: unknown;

            try {
                detectionResult =
                    await this.promptContextEngine.detectAndResolveReferences({
                        requirementId: consumerId,
                        promptText: field.text,
                        path: field.path,
                        sourceType: field.sourceType,
                        repositoryId: repositoryId ?? 'global',
                        repositoryName:
                            repositoryName ?? repositoryId ?? 'global',
                        organizationAndTeamData,
                        context: 'instruction',
                    });
            } catch (error) {
                detectionError = error;
                this.logger.warn({
                    message:
                        'Failed to resolve external references for prompt section',
                    context: UpdateOrCreateCodeReviewParameterUseCase.name,
                    error,
                    metadata: {
                        requirementId: consumerId,
                        organizationId,
                        repositoryId,
                        directoryId,
                    },
                });
            }

            const detectionRequirement =
                detectionResult?.requirements?.find(
                    (requirement) => requirement.id === consumerId,
                ) ?? detectionResult?.requirements?.[0];

            const detectionNormalization = this.normalizeMCPDependencies(
                detectionRequirement?.dependencies,
                providerAliases,
                toolAliases,
                allowedTools,
                toolMetadata,
            );

            const combinedDependencies = this.mergeDependencies(
                promptNormalization.dependencies,
                detectionNormalization.dependencies,
            );

            const markersSet = new Set<string>([
                ...mcpMarkers,
                ...(detectionResult?.markers ?? []),
                ...(Array.isArray(detectionRequirement?.metadata?.inlineMarkers)
                    ? (detectionRequirement?.metadata
                          ?.inlineMarkers as string[])
                    : []),
            ]);

            const syncErrorsRaw: IPromptReferenceSyncError[] = [
                ...promptNormalization.errors,
                ...detectionNormalization.errors,
                ...(detectionResult?.syncErrors ?? []),
                ...(Array.isArray(detectionRequirement?.metadata?.syncErrors)
                    ? (detectionRequirement?.metadata
                          ?.syncErrors as IPromptReferenceSyncError[])
                    : []),
            ];

            if (detectionError) {
                syncErrorsRaw.push({
                    type: PromptReferenceErrorType.DETECTION_FAILED,
                    message:
                        detectionError instanceof Error
                            ? detectionError.message
                            : String(detectionError),
                    details: {
                        timestamp: new Date(),
                    },
                });
            }

            const syncErrors = dedupeSyncErrors(syncErrorsRaw);

            const promptHash = detectionResult?.promptHash ?? basePromptHash;

            if (combinedDependencies.length === 0 && syncErrors.length === 0) {
                continue;
            }

            mergedRequirements.push({
                id: consumerId,
                consumer: {
                    id: consumerId,
                    kind: 'prompt_section',
                    name: pathKey,
                    metadata: {
                        path: field.path,
                        sourceType: field.sourceType,
                    },
                },
                request: {
                    domain: DEFAULT_REVIEW_QUERY.domain,
                    taskIntent: DEFAULT_REVIEW_QUERY.taskIntent,
                    signal: {
                        metadata: {
                            consumerId,
                            path: field.path,
                            sourceType: field.sourceType,
                        },
                    },
                },
                dependencies: combinedDependencies,
                metadata: {
                    path: field.path,
                    sourceType: field.sourceType,
                    sourceSnippet: field.text,
                    inlineMarkers: Array.from(markersSet.values()),
                    syncErrors,
                    promptHash,
                },
                status: syncErrors.length > 0 ? 'draft' : 'active',
            });
        }

        if (!mergedRequirements.length) {
            delete contextTarget.contextReferenceId;
            delete contextTarget.contextRequirementsHash;
            if (nestedTarget) {
                delete nestedTarget.contextReferenceId;
                delete nestedTarget.contextRequirementsHash;
            }
            return;
        }

        const candidateHash = computeRequirementsDigest(mergedRequirements);

        if (
            candidateHash &&
            candidateHash === oldConfig?.contextRequirementsHash &&
            oldConfig?.contextReferenceId
        ) {
            contextTarget.contextReferenceId = oldConfig.contextReferenceId;
            contextTarget.contextRequirementsHash =
                oldConfig.contextRequirementsHash;
            if (nestedTarget) {
                nestedTarget.contextReferenceId = oldConfig.contextReferenceId;
                nestedTarget.contextRequirementsHash =
                    oldConfig.contextRequirementsHash;
            }
            return;
        }

        const normalizedRepositoryId =
            repositoryId && repositoryId !== 'global'
                ? repositoryId
                : undefined;

        const knowledgeRefs = buildKnowledgeRefs(mergedRequirements);

        const scope = buildContextRevisionScope({
            organizationId,
            teamId: organizationAndTeamData.teamId,
            repositoryId: normalizedRepositoryId,
            directoryId,
            level,
        });

        const entityId = buildContextEntityId({
            organizationId,
            teamId: organizationAndTeamData.teamId,
            repositoryId: normalizedRepositoryId,
            directoryId,
        });

        const requirementSummaries = mergedRequirements.map((requirement) => ({
            id: requirement.id,
            path: Array.isArray(requirement.metadata?.path)
                ? (requirement.metadata?.path as string[])
                : undefined,
            markers: requirement.metadata?.inlineMarkers,
            dependencyIds: (requirement.dependencies ?? []).map(
                (dependency) => dependency.id,
            ),
        }));

        const { pointer } = await this.contextReferenceService.commitRevision({
            scope,
            entityType: 'code_review_config',
            entityId,
            requirements: mergedRequirements,
            parentReferenceId: oldConfig?.contextReferenceId,
            knowledgeRefs,
            origin: {
                kind: 'user',
                id: this.request?.user?.uuid ?? 'unknown',
            },
            metadata: {
                level,
                repositoryId: normalizedRepositoryId,
                directoryId,
                configKey: entityId,
                requirementSummaries,
            },
        });

        contextTarget.contextReferenceId = pointer.uuid;
        contextTarget.contextRequirementsHash =
            candidateHash ?? pointer.requirementsHash;
        if (nestedTarget) {
            nestedTarget.contextReferenceId = pointer.uuid;
            nestedTarget.contextRequirementsHash =
                candidateHash ?? pointer.requirementsHash;
        }
    }
    private resolveOverridesForContext(
        config: CreateOrUpdateCodeReviewParameterDto['configValue'],
    ): {
        summaryText?: string;
        overrides: PromptOverrides | undefined;
        contextTarget: Record<string, any>;
        nestedTarget?: Record<string, any>;
    } {
        const contextTarget = config as Record<string, any>;
        let nestedTarget: Record<string, any> | undefined;
        let overrides: PromptOverrides | undefined;

        const maybeNested =
            config &&
            typeof config === 'object' &&
            'configs' in config &&
            (config as Record<string, unknown>).configs &&
            typeof (config as Record<string, unknown>).configs === 'object'
                ? ((config as Record<string, unknown>).configs as Record<
                      string,
                      unknown
                  >)
                : undefined;

        if (config?.v2PromptOverrides) {
            overrides = config.v2PromptOverrides as PromptOverrides;
        } else if (
            maybeNested &&
            typeof maybeNested.v2PromptOverrides === 'object' &&
            maybeNested.v2PromptOverrides
        ) {
            overrides = maybeNested.v2PromptOverrides as PromptOverrides;
            nestedTarget = maybeNested as Record<string, any>;
        }

        const summaryFromContext =
            contextTarget?.summary &&
            typeof contextTarget.summary === 'object' &&
            contextTarget.summary !== null &&
            typeof contextTarget.summary.customInstructions === 'string'
                ? (contextTarget.summary.customInstructions as string)
                : undefined;

        const summaryFromNested =
            nestedTarget?.summary &&
            typeof nestedTarget.summary === 'object' &&
            nestedTarget.summary !== null &&
            typeof nestedTarget.summary.customInstructions === 'string'
                ? (nestedTarget.summary.customInstructions as string)
                : undefined;

        return {
            summaryText: summaryFromContext ?? summaryFromNested ?? undefined,
            overrides,
            contextTarget,
            nestedTarget,
        };
    }

    private mergeDependencies(
        primary?: ContextDependency[],
        secondary?: ContextDependency[],
    ): ContextDependency[] {
        const map = new Map<string, ContextDependency>();

        for (const dependency of primary ?? []) {
            const key = `${dependency.type}:${dependency.id}`;
            map.set(key, dependency);
        }

        for (const dependency of secondary ?? []) {
            const key = `${dependency.type}:${dependency.id}`;
            if (map.has(key)) {
                const existing = map.get(key)!;
                map.set(key, {
                    ...existing,
                    ...dependency,
                    metadata: {
                        ...(existing.metadata ?? {}),
                        ...(dependency.metadata ?? {}),
                    },
                });
            } else {
                map.set(key, dependency);
            }
        }

        return Array.from(map.values());
    }

    private buildMCPAliasStructures(connections: MCPServerConfig[]): {
        providerAliases: Map<string, string>;
        toolAliases: Map<string, Map<string, string>>;
        allowedTools: Map<string, Set<string>>;
    } {
        const providerAliases = new Map<string, string>();
        const toolAliases = new Map<string, Map<string, string>>();
        const allowedTools = new Map<string, Set<string>>();

        const registerProviderAlias = (
            alias: string | undefined,
            canonical: string,
        ) => {
            const trimmed = alias?.trim();
            if (!trimmed) {
                return;
            }
            if (!providerAliases.has(trimmed)) {
                providerAliases.set(trimmed, canonical);
            }
            const normalized = this.normalizeProviderKey(trimmed);
            if (normalized && !providerAliases.has(normalized)) {
                providerAliases.set(normalized, canonical);
            }
        };

        const registerToolAlias = (
            aliasMap: Map<string, string>,
            canonicalTool: string,
        ) => {
            const trimmed = canonicalTool?.trim();
            if (!trimmed) {
                return;
            }

            if (!aliasMap.has(trimmed)) {
                aliasMap.set(trimmed, trimmed);
            }

            const lower = trimmed.toLowerCase();
            if (!aliasMap.has(lower)) {
                aliasMap.set(lower, trimmed);
            }

            const upper = trimmed.toUpperCase();
            if (!aliasMap.has(upper)) {
                aliasMap.set(upper, trimmed);
            }

            const normalized = this.normalizeToolKey(trimmed);
            if (normalized && !aliasMap.has(normalized)) {
                aliasMap.set(normalized, trimmed);
            }
        };

        for (const connection of connections ?? []) {
            const canonicalProvider =
                connection.provider?.trim() ||
                connection.name?.trim() ||
                connection.url?.trim();

            if (!canonicalProvider) {
                continue;
            }

            registerProviderAlias(canonicalProvider, canonicalProvider);
            registerProviderAlias(connection.provider, canonicalProvider);
            registerProviderAlias(connection.name, canonicalProvider);
            registerProviderAlias(connection.url, canonicalProvider);

            if (!allowedTools.has(canonicalProvider)) {
                allowedTools.set(canonicalProvider, new Set());
            }

            if (!toolAliases.has(canonicalProvider)) {
                toolAliases.set(canonicalProvider, new Map());
            }

            const aliasMap = toolAliases.get(canonicalProvider)!;
            const providerAllowedTools = allowedTools.get(canonicalProvider)!;

            for (const tool of connection.allowedTools ?? []) {
                const canonicalTool = tool?.trim();
                if (!canonicalTool) {
                    continue;
                }

                providerAllowedTools.add(canonicalTool);
                registerToolAlias(aliasMap, canonicalTool);
            }
        }

        return { providerAliases, toolAliases, allowedTools };
    }

    private normalizeMCPDependencies(
        dependencies: ContextDependency[] | undefined,
        providerAliases: Map<string, string>,
        toolAliases: Map<string, Map<string, string>>,
        allowedTools: Map<string, Set<string>>,
        toolMetadata: Map<string, MCPToolMetadata>,
    ): {
        dependencies: ContextDependency[];
        errors: IPromptReferenceSyncError[];
    } {
        if (!dependencies?.length) {
            return { dependencies: [], errors: [] };
        }

        const merged: ContextDependency[] = [];
        const errors: IPromptReferenceSyncError[] = [];

        for (const dependency of dependencies) {
            const normalized = this.normalizeDependency(
                dependency,
                providerAliases,
                toolAliases,
                allowedTools,
            );
            if (normalized.errors.length) {
                errors.push(...normalized.errors);
            }
            if (normalized.dependency) {
                const enriched = this.applyToolMetadata(
                    normalized.dependency,
                    toolMetadata,
                    providerAliases,
                    toolAliases,
                );
                merged.push(enriched);
            }
        }

        return { dependencies: merged, errors };
    }

    private normalizeDependency(
        dependency: ContextDependency,
        providerAliases: Map<string, string>,
        toolAliases: Map<string, Map<string, string>>,
        allowedTools: Map<string, Set<string>>,
    ): {
        dependency?: ContextDependency;
        errors: IPromptReferenceSyncError[];
    } {
        if (dependency.type !== 'mcp' && dependency.type !== 'tool') {
            return { dependency, errors: [] };
        }

        const originalProvider = this.resolveDependencyProvider(dependency);
        const canonicalProvider = originalProvider
            ? this.resolveCanonicalProvider(originalProvider, providerAliases)
            : undefined;

        const errors: IPromptReferenceSyncError[] = [];

        const finalProvider =
            canonicalProvider ??
            (originalProvider && allowedTools.has(originalProvider)
                ? originalProvider
                : undefined);

        if (!finalProvider) {
            if (originalProvider) {
                errors.push({
                    type: PromptReferenceErrorType.INVALID_FORMAT,
                    message: `MCP provider "${originalProvider}" is not configured for this organization/team. Adjust the prompt or enable the corresponding connection.`,
                    details: {
                        timestamp: new Date(),
                    },
                });
            }
            return { dependency: undefined, errors };
        }

        const originalTool = this.resolveDependencyToolName(dependency);
        const canonicalTool = this.resolveCanonicalTool(
            originalTool,
            finalProvider,
            toolAliases,
        );
        const finalTool = canonicalTool ?? originalTool;

        const metadata: Record<string, unknown> = {
            ...(dependency.metadata ?? {}),
        };

        metadata.provider = finalProvider;
        if (
            originalProvider &&
            originalProvider !== finalProvider &&
            !metadata.providerAlias
        ) {
            metadata.providerAlias = originalProvider;
        }

        if (finalTool) {
            metadata.toolName = finalTool;
        }
        if (
            originalTool &&
            finalTool &&
            originalTool !== finalTool &&
            !metadata.toolNameAlias
        ) {
            metadata.toolNameAlias = originalTool;
        }

        if (!finalTool && originalTool) {
            const available = allowedTools.get(finalProvider);
            const availableList = available
                ? Array.from(available.values()).join(', ')
                : 'no tools registered';

            errors.push({
                type: PromptReferenceErrorType.INVALID_FORMAT,
                message: `Tool "${originalTool}" is not enabled for MCP provider "${finalProvider}". Available tools: ${availableList}.`,
                details: {
                    timestamp: new Date(),
                },
            });
            return { dependency: undefined, errors };
        }

        let descriptor = dependency.descriptor;
        if (descriptor && typeof descriptor === 'object') {
            const candidate = descriptor as Record<string, unknown>;
            descriptor = {
                ...candidate,
                mcpId: finalProvider,
                ...(finalTool ? { toolName: finalTool } : {}),
            };
        }

        let normalizedId = dependency.id;
        if (finalTool) {
            normalizedId = `${finalProvider}|${finalTool}`;
        } else if (
            typeof normalizedId === 'string' &&
            normalizedId.includes('|')
        ) {
            const [, tool] = normalizedId.split('|', 2);
            normalizedId = tool ? `${finalProvider}|${tool}` : finalProvider;
        } else {
            normalizedId = finalProvider;
        }

        return {
            dependency: {
                ...dependency,
                id: normalizedId,
                metadata,
                descriptor,
            },
            errors,
        };
    }

    private applyToolMetadata(
        dependency: ContextDependency,
        metadataMap: Map<string, MCPToolMetadata>,
        providerAliases: Map<string, string>,
        toolAliases: Map<string, Map<string, string>>,
    ): ContextDependency {
        const provider = this.resolveDependencyProvider(dependency);
        const toolName = this.resolveDependencyToolName(dependency);

        if (!provider || !toolName) {
            return dependency;
        }

        const canonicalProvider =
            this.resolveCanonicalProvider(provider, providerAliases) ??
            provider;
        const canonicalToolName =
            this.resolveCanonicalTool(
                toolName,
                canonicalProvider,
                toolAliases,
            ) ?? toolName;

        const metadataEntry = this.mcpToolMetadataService.resolveToolMetadata(
            metadataMap,
            canonicalProvider,
            canonicalToolName,
        );

        const resolvedProvider = metadataEntry?.providerId ?? canonicalProvider;
        const resolvedToolName = metadataEntry?.toolName ?? canonicalToolName;
        const metadata = metadataEntry?.metadata;

        if (!metadata) {
            return dependency;
        }

        const currentMetadata = (dependency.metadata ?? {}) as Record<
            string,
            unknown
        >;
        const existingRequired = Array.isArray(currentMetadata.requiredArgs)
            ? (currentMetadata.requiredArgs as string[])
            : [];
        const mergedRequired = Array.from(
            new Set([...existingRequired, ...metadata.requiredArgs]),
        );

        const mergedMetadata = {
            ...currentMetadata,
            requiredArgs: mergedRequired,
            toolInputSchema: metadata.inputSchema,
            provider: resolvedProvider,
            toolName: resolvedToolName,
        } as Record<string, unknown>;

        if (
            provider &&
            resolvedProvider &&
            provider !== resolvedProvider &&
            !mergedMetadata.providerAlias
        ) {
            mergedMetadata.providerAlias = provider;
        }

        if (
            toolName &&
            resolvedToolName &&
            toolName !== resolvedToolName &&
            !mergedMetadata.toolNameAlias
        ) {
            mergedMetadata.toolNameAlias = toolName;
        }

        let descriptor = dependency.descriptor;
        if (descriptor && typeof descriptor === 'object') {
            const candidate = descriptor as Record<string, unknown>;
            descriptor = {
                ...candidate,
                mcpId: resolvedProvider,
                toolName: resolvedToolName,
            };
        }

        return {
            ...dependency,
            id: `${resolvedProvider}|${resolvedToolName}`,
            metadata: mergedMetadata,
            descriptor,
        };
    }

    private resolveCanonicalProvider(
        provider: string,
        aliasMap: Map<string, string>,
    ): string | undefined {
        const trimmed = provider?.trim();
        if (!trimmed) {
            return undefined;
        }

        if (aliasMap.has(trimmed)) {
            return aliasMap.get(trimmed);
        }

        const key = this.normalizeProviderKey(trimmed);
        if (key && aliasMap.has(key)) {
            return aliasMap.get(key);
        }

        return undefined;
    }

    private resolveCanonicalTool(
        toolName: string | undefined,
        provider: string,
        toolAliases: Map<string, Map<string, string>>,
    ): string | undefined {
        if (!toolName) {
            return undefined;
        }

        const trimmedProvider = provider?.trim();
        if (!trimmedProvider) {
            return undefined;
        }

        const aliasMap = toolAliases.get(trimmedProvider);

        if (!aliasMap) {
            return undefined;
        }

        const trimmedTool = toolName.trim();
        if (!trimmedTool) {
            return undefined;
        }

        if (aliasMap.has(trimmedTool)) {
            return aliasMap.get(trimmedTool);
        }

        const lower = trimmedTool.toLowerCase();
        if (aliasMap.has(lower)) {
            return aliasMap.get(lower);
        }

        const upper = trimmedTool.toUpperCase();
        if (aliasMap.has(upper)) {
            return aliasMap.get(upper);
        }

        const normalized = this.normalizeToolKey(trimmedTool);
        if (normalized && aliasMap.has(normalized)) {
            return aliasMap.get(normalized);
        }

        return undefined;
    }

    private resolveDependencyProvider(
        dependency: ContextDependency,
    ): string | undefined {
        const metadata = dependency.metadata as
            | Record<string, unknown>
            | undefined;

        if (metadata) {
            const provider = metadata.provider as string | undefined;
            if (provider && provider.trim()) {
                return provider;
            }

            const providerAlias = metadata.providerAlias as string | undefined;
            if (providerAlias && providerAlias.trim()) {
                return providerAlias;
            }
        }

        if (
            dependency.descriptor &&
            typeof dependency.descriptor === 'object'
        ) {
            const candidate = dependency.descriptor as Record<string, unknown>;
            const descriptorProvider = candidate.mcpId as string | undefined;
            if (descriptorProvider && descriptorProvider.trim()) {
                return descriptorProvider;
            }
        }

        if (typeof dependency.id === 'string' && dependency.id.includes('|')) {
            const [providerId] = dependency.id.split('|', 2);
            if (providerId && providerId.trim()) {
                return providerId;
            }
        }

        return undefined;
    }

    private resolveDependencyToolName(
        dependency: ContextDependency,
    ): string | undefined {
        const metadata = dependency.metadata as
            | Record<string, unknown>
            | undefined;

        if (metadata && typeof metadata.toolName === 'string') {
            return metadata.toolName;
        }

        if (
            dependency.descriptor &&
            typeof dependency.descriptor === 'object'
        ) {
            const candidate = dependency.descriptor as Record<string, unknown>;
            if (typeof candidate.toolName === 'string') {
                return candidate.toolName;
            }
        }

        if (typeof dependency.id === 'string' && dependency.id.includes('|')) {
            const [, tool] = dependency.id.split('|', 2);
            if (tool && tool.trim()) {
                return tool;
            }
        }

        return undefined;
    }

    private normalizeProviderKey(value?: string | null): string | undefined {
        if (!value) {
            return undefined;
        }

        const normalized = value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');

        if (!normalized) {
            return undefined;
        }

        return normalized.endsWith('mcp') && normalized.length > 3
            ? normalized.slice(0, -3)
            : normalized;
    }

    private normalizeToolKey(value?: string | null): string | undefined {
        if (!value) {
            return undefined;
        }

        const normalized = value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');

        return normalized || undefined;
    }

    private resolveBaseConsumerId(
        config: CreateOrUpdateCodeReviewParameterDto['configValue'],
    ): string {
        if (config?.codeReviewVersion === CodeReviewVersion.v2) {
            return 'code-review-v2';
        }

        if (config?.codeReviewVersion === CodeReviewVersion.LEGACY) {
            return 'code-review-legacy';
        }

        return 'code-review';
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

type PromptOverrides = NonNullable<
    CreateOrUpdateCodeReviewParameterDto['configValue']['v2PromptOverrides']
>;

const DEFAULT_REVIEW_QUERY: RetrievalQuery = {
    domain: 'code',
    taskIntent: 'review',
    signal: {},
};

function computeRequirementsDigest(
    requirements: ContextRequirement[],
): string | undefined {
    if (!requirements.length) {
        return undefined;
    }

    const normalized = requirements
        .map((requirement) => ({
            id: requirement.id,
            dependencies: (requirement.dependencies ?? [])
                .map((dependency) => ({
                    type: dependency.type,
                    id: dependency.id,
                }))
                .sort((a, b) => a.id.localeCompare(b.id)),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

    const payload = JSON.stringify(normalized);
    return createHash('sha256').update(payload).digest('hex');
}

function buildContextRevisionScope(options: {
    organizationId: string;
    teamId?: string;
    repositoryId?: string;
    directoryId?: string;
    level: ConfigLevel;
}): ContextRevisionScope {
    const { organizationId, teamId, repositoryId, directoryId, level } =
        options;

    const identifiers: Record<string, string> = {
        tenantId: organizationId, // tenant = organization (convenção padronizada)
        organizationId,
    };
    const path: Array<{ level: string; id: string }> = [
        { level: 'organization', id: organizationId },
    ];

    if (teamId) {
        identifiers.teamId = teamId;
        path.push({ level: 'team', id: teamId });
    }

    let scopeLevel = 'global';

    if (repositoryId) {
        identifiers.repositoryId = repositoryId;
        path.push({ level: 'repository', id: repositoryId });
        scopeLevel = 'repository';
    }

    if (directoryId) {
        identifiers.directoryId = directoryId;
        path.push({ level: 'directory', id: directoryId });
        scopeLevel = 'directory';
    }

    if (level === ConfigLevel.GLOBAL) {
        scopeLevel = 'global';
    }

    return {
        level: scopeLevel,
        identifiers,
        path,
        metadata: {
            level,
            teamId: teamId ?? null,
        },
    };
}

function buildContextEntityId(options: {
    organizationId: string;
    teamId?: string;
    repositoryId?: string;
    directoryId?: string;
}): string {
    const { organizationId, teamId, repositoryId, directoryId } = options;
    const segments = [`org:${organizationId}`];

    if (teamId) {
        segments.push(`team:${teamId}`);
    }

    if (repositoryId) {
        segments.push(`repo:${repositoryId}`);
    }

    if (directoryId) {
        segments.push(`dir:${directoryId}`);
    }

    return segments.join('/');
}

function dedupeSyncErrors(
    errors: IPromptReferenceSyncError[],
): IPromptReferenceSyncError[] {
    const seen = new Set<string>();
    const result: IPromptReferenceSyncError[] = [];

    for (const error of errors) {
        if (!error) continue;

        const fileName = error.details?.fileName ?? '';
        const repositoryName = error.details?.repositoryName ?? '';
        const key = `${error.type}:${error.message}:${fileName}:${repositoryName}`;

        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        result.push({
            ...error,
            details: error.details
                ? {
                      ...error.details,
                      timestamp: error.details.timestamp
                          ? new Date(error.details.timestamp)
                          : undefined,
                  }
                : {},
        });
    }

    return result;
}

function buildKnowledgeRefs(
    requirements: ContextRequirement[],
): Array<{ itemId: string; version?: string }> {
    const refs: Array<{ itemId: string; version?: string }> = [];
    const seen = new Set<string>();

    for (const requirement of requirements) {
        for (const dependency of requirement.dependencies ?? []) {
            if (dependency.type !== 'knowledge') {
                continue;
            }

            const metadata = dependency.metadata as
                | Record<string, unknown>
                | undefined;
            const repositoryName =
                typeof metadata?.repositoryName === 'string'
                    ? metadata.repositoryName
                    : 'unknown-repo';
            const filePath =
                typeof metadata?.filePath === 'string'
                    ? metadata.filePath
                    : dependency.id;

            const itemId =
                typeof dependency.id === 'string' && dependency.id
                    ? dependency.id
                    : `${repositoryName}|${filePath}`;

            if (seen.has(itemId)) {
                continue;
            }
            seen.add(itemId);

            const version =
                typeof metadata?.lastContentHash === 'string'
                    ? metadata.lastContentHash
                    : undefined;

            refs.push({ itemId, version });
        }
    }

    return refs;
}
