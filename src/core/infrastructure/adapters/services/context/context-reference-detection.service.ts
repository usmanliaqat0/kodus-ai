import { Inject, Injectable } from '@nestjs/common';
import {
    IPromptContextEngineService,
    PROMPT_CONTEXT_ENGINE_SERVICE_TOKEN,
} from '@/core/domain/prompts/contracts/promptContextEngine.contract';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { PromptSourceType } from '@/core/domain/prompts/interfaces/promptExternalReference.interface';
import {
    CONTEXT_REFERENCE_SERVICE_TOKEN,
    IContextReferenceService,
} from '@/core/domain/contextReferences/contracts/context-reference.service.contract';
import { PinoLoggerService } from '../logger/pino.service';
import {
    MCPToolMetadataService,
    MCPToolMetadata,
} from '@/core/infrastructure/adapters/mcp/services/mcp-tool-metadata.service';
import type { MCPServerConfig } from '@kodus/flow';
import type {
    ContextDependency,
    ContextRequirement,
} from '@context-os-core/interfaces';

export interface ContextReferenceDetectionParams {
    entityType: 'kodyRule' | 'codeReviewConfig';
    entityId: string;
    text: string;
    path: string[];
    sourceType: PromptSourceType;
    repositoryId?: string;
    repositoryName?: string;
    organizationAndTeamData: OrganizationAndTeamData;
    detectionMode?: 'rule' | 'prompt';
}

@Injectable()
export class ContextReferenceDetectionService {
    constructor(
        @Inject(PROMPT_CONTEXT_ENGINE_SERVICE_TOKEN)
        private readonly promptContextEngine: IPromptContextEngineService,
        @Inject(CONTEXT_REFERENCE_SERVICE_TOKEN)
        private readonly contextReferenceService: IContextReferenceService,
        private readonly logger: PinoLoggerService,
        private readonly mcpToolMetadataService: MCPToolMetadataService,
    ) {}

    async detectAndSaveReferences(
        params: ContextReferenceDetectionParams,
    ): Promise<string | undefined> {
        const {
            entityType,
            entityId,
            text,
            path,
            sourceType,
            repositoryId,
            repositoryName,
            organizationAndTeamData,
            detectionMode,
        } = params;

        this.logger.debug({
            message: `Starting reference detection for ${entityType}`,
            context: ContextReferenceDetectionService.name,
            metadata: {
                entityType,
                entityId,
                textLength: text.length,
                repositoryId,
                organizationAndTeamData,
            },
        });

        const detection =
            await this.promptContextEngine.detectAndResolveReferences({
                requirementId: `${entityType}:${entityId}`,
                promptText: text,
                path,
                sourceType,
                repositoryId,
                repositoryName,
                organizationAndTeamData,
                detectionMode,
            });

        let { requirements, syncErrors } = detection;

        // Se não tem requirements nem erros, não salva nada
        if (!requirements.length && !syncErrors.length) {
            this.logger.debug({
                message: `No references detected for ${entityType}, skipping save`,
                context: ContextReferenceDetectionService.name,
                metadata: { entityType, entityId },
            });
            return undefined;
        }

        // Para entidades que suportam MCPs, normalizar as dependências com aliases
        if (entityType === 'kodyRule' || entityType === 'codeReviewConfig') {
            const normalized = await this.normalizeRequirementsWithMCPs(
                requirements,
                syncErrors,
                organizationAndTeamData,
            );
            requirements = normalized.requirements;
            syncErrors = normalized.syncErrors;
        }

        this.logger.log({
            message: `Saving ${requirements.length} requirements and ${syncErrors.length} errors to Context OS`,
            context: ContextReferenceDetectionService.name,
            metadata: {
                entityType,
                entityId,
                requirementsCount: requirements.length,
                syncErrorsCount: syncErrors.length,
            },
        });

        // Gerar revisionId para ponte com fonte da verdade
        const revisionId = `rev:${entityType}:${entityId}:${Date.now()}`;

        // 🔧 AJUSTE: Scope completo com tenant/organization/repository
        // Determinar nível baseado no entityType e contexto
        const scopeLevel = this.determineScopeLevel(entityType, repositoryId);
        const scopeIdentifiers = {
            tenantId: organizationAndTeamData.organizationId, // tenant = organization
            organizationId: organizationAndTeamData.organizationId,
            ...(organizationAndTeamData.teamId && {
                teamId: organizationAndTeamData.teamId,
            }),
            ...(repositoryId && { repositoryId }),
        };

        const scopePath = this.buildScopePath(
            scopeLevel,
            organizationAndTeamData.organizationId,
            organizationAndTeamData.teamId,
            repositoryId,
        );

        const scope = {
            level: scopeLevel,
            identifiers: scopeIdentifiers,
            path: scopePath,
            metadata: {
                source: entityType, // 'kodyRule' ou 'codeReviewConfig'
            },
        };

        const result = await this.contextReferenceService.commitRevision({
            scope,
            entityType,
            entityId,
            requirements,
            origin: { kind: 'system', id: 'kody-system' },
            revisionId, // Ponte para fonte da verdade
        });

        const contextReferenceId = result.pointer.uuid;

        this.logger.log({
            message: `Successfully saved references for ${entityType}`,
            context: ContextReferenceDetectionService.name,
            metadata: {
                entityType,
                entityId,
                contextReferenceId,
                requirementsHash: result.pointer.requirementsHash,
            },
        });

        return contextReferenceId;
    }

    private async normalizeRequirementsWithMCPs(
        requirements: ContextRequirement[],
        syncErrors: any[],
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<{ requirements: ContextRequirement[]; syncErrors: any[] }> {
        // Carregar metadados MCP para a organização
        const { connections: mcpConnections, metadata: toolMetadata } =
            await this.mcpToolMetadataService.loadMetadataForOrganization(
                organizationAndTeamData,
            );

        // Construir estruturas de aliases
        const { providerAliases, toolAliases, allowedTools } =
            this.buildMCPAliasStructures(mcpConnections);

        // Normalizar cada requirement
        const normalizedRequirements = requirements.map((requirement) => ({
            ...requirement,
            dependencies: this.normalizeMCPDependencies(
                requirement.dependencies,
                providerAliases,
                toolAliases,
                allowedTools,
                toolMetadata,
            ).dependencies,
        }));

        // Normalizar syncErrors (mesma lógica do UpdateOrCreateCodeReviewParameterUseCase)
        const normalizedSyncErrors = this.normalizeMCPDependencies(
            [], // Não temos dependências brutas aqui, apenas erros
            providerAliases,
            toolAliases,
            allowedTools,
            toolMetadata,
        ).errors; // Os erros vêm da normalização

        return {
            requirements: normalizedRequirements,
            syncErrors: [...syncErrors, ...normalizedSyncErrors],
        };
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
        errors: any[];
    } {
        if (!dependencies?.length) {
            return { dependencies: [], errors: [] };
        }

        const merged: ContextDependency[] = [];
        const errors: any[] = [];

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
        errors: any[];
    } {
        if (dependency.type !== 'mcp' && dependency.type !== 'tool') {
            return { dependency, errors: [] };
        }

        const originalProvider = this.resolveDependencyProvider(dependency);
        const canonicalProvider = originalProvider
            ? this.resolveCanonicalProvider(originalProvider, providerAliases)
            : undefined;

        const errors: any[] = [];

        const finalProvider =
            canonicalProvider ??
            (originalProvider && allowedTools.has(originalProvider)
                ? originalProvider
                : undefined);

        if (!finalProvider) {
            if (originalProvider) {
                errors.push({
                    type: 'invalid_format',
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
                type: 'invalid_format',
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

            // Fallback para 'app' (formato antigo do extractMCPDependencies)
            const app = metadata.app as string | undefined;
            if (app && app.trim()) {
                return app;
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

        if (metadata) {
            if (typeof metadata.toolName === 'string') {
                return metadata.toolName;
            }

            // Fallback para 'tool' (formato antigo do extractMCPDependencies)
            if (typeof metadata.tool === 'string') {
                return metadata.tool;
            }
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

    /**
     * Determina o nível do scope baseado no entityType e contexto
     */
    private determineScopeLevel(
        entityType: string,
        repositoryId?: string,
    ): string {
        switch (entityType) {
            case 'kodyRule':
                // KodyRules podem ser global ou por repository
                return repositoryId && repositoryId !== 'global'
                    ? 'repository'
                    : 'organization';
            case 'codeReviewConfig':
                // Code review configs geralmente são por repository
                return 'repository';
            default:
                return 'organization'; // fallback seguro
        }
    }

    /**
     * Constrói o path do scope baseado no nível determinado
     */
    private buildScopePath(
        scopeLevel: string,
        organizationId: string,
        teamId?: string,
        repositoryId?: string,
    ): Array<{ level: string; id: string }> {
        const path: Array<{ level: string; id: string }> = [
            { level: 'organization', id: organizationId },
        ];

        if (teamId) {
            path.push({ level: 'team', id: teamId });
        }

        if (scopeLevel === 'repository' && repositoryId) {
            path.push({ level: 'repository', id: repositoryId });
        }

        return path;
    }
}
