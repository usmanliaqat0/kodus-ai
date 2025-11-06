import { Injectable } from '@nestjs/common';
import { createMCPAdapter, type MCPServerConfig } from '@kodus/flow';
import type { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import type { CodeReviewConfig } from '@/config/types/general/codeReview.type';
import type {
    ContextDependency,
    ContextLayer,
    ContextLayerBuilder,
    ContextPack,
    ContextRequirement,
    LayerInputContext,
    LayerBuildOptions,
    LayerBuildResult,
    MCPInvocationRequest,
    MCPInvocationResult,
    MCPRegistration,
    PackAssemblyStep,
} from '@context-os-core/interfaces';
import { MCPOrchestrator } from '@context-os-core/mcp/orchestrator';
import { InMemoryMCPRegistry } from '@context-os-core/mcp/registry';
import { SequentialPackAssemblyPipeline } from '@context-os-core/pipeline/sequential-pack-pipeline';
import { ContextReferenceService } from './context-reference.service';
import { MCPToolArgResolverAgentService } from './mcp-tool-arg-resolver-agent.service';
import {
    CODE_REVIEW_CONTEXT_PATTERNS,
    pathToKey,
    stripMarkersFromText,
} from './code-review-context.utils';
import {
    MCPToolMetadata,
    MCPToolMetadataService,
} from '../../mcp/services/mcp-tool-metadata.service';
import { PinoLoggerService } from '../logger/pino.service';

export interface ContextAugmentationOutput {
    provider?: string;
    toolName: string;
    success: boolean;
    output?: string;
    error?: string;
}

export type ContextAugmentationsMap = Record<
    string,
    {
        path: string[];
        requirementId?: string;
        outputs: ContextAugmentationOutput[];
    }
>;

export interface SkippedMCPTool {
    provider?: string;
    toolName?: string;
    requirementId?: string;
    path?: string[];
    missingArgs: string[];
    message: string;
}

interface BuildPackParams {
    organizationAndTeamData?: OrganizationAndTeamData;
    contextReferenceId?: string;
    overrides?: CodeReviewConfig['v2PromptOverrides'];
    externalLayers?: ContextLayer[];
}

interface BuildPackResult {
    sanitizedOverrides?: CodeReviewConfig['v2PromptOverrides'];
    augmentations?: ContextAugmentationsMap;
    pack?: ContextPack;
}

const MAX_TOOL_OUTPUT_LENGTH = 1200;
const DEFAULT_LAYER_INPUT: LayerInputContext = {
    domain: 'code',
    taskIntent: 'review',
    retrieval: {
        candidates: [],
    },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Une os argumentos declarados na dependência MCP com o contexto padrão
 * passado pelo orchestrator, priorizando os valores explícitos do requisito.
 */
function resolveMCPArgs(
    request: MCPInvocationRequest,
): Record<string, unknown> {
    const metadata = (request.tool.metadata ?? {}) as Record<string, unknown>;
    const rawArgs = metadata.args;
    const args: Record<string, unknown> = isPlainObject(rawArgs)
        ? { ...(rawArgs as Record<string, unknown>) }
        : {};

    if (request.input && isPlainObject(request.input)) {
        if (isPlainObject(args.context)) {
            args.context = {
                ...(request.input as Record<string, unknown>),
                ...(args.context as Record<string, unknown>),
            };
        } else if (!Object.prototype.hasOwnProperty.call(args, 'context')) {
            args.context = request.input;
        } else {
            args.__context = request.input;
        }
    }

    return args;
}

class StaticLayerBuilder implements ContextLayerBuilder {
    public readonly stage = 'core' as unknown as ContextLayerBuilder['stage'];

    constructor(private readonly layerFactory: () => ContextLayer) {}

    async build(
        _input: LayerInputContext,
        _options?: LayerBuildOptions,
    ): Promise<LayerBuildResult> {
        return {
            layer: this.layerFactory(),
            resources: [],
        };
    }
}

class AdapterBackedMCPClient {
    constructor(
        private readonly adapter: ReturnType<typeof createMCPAdapter>,
        private readonly connectionById: Map<string, MCPServerConfig>,
    ) {}

    async invoke(request: MCPInvocationRequest): Promise<MCPInvocationResult> {
        const startedAt = Date.now();

        try {
            const serverConfig = this.connectionById.get(request.registry.id);
            const metadataServerName =
                request.registry.metadata &&
                typeof (request.registry.metadata as Record<string, unknown>)
                    .serverName === 'string'
                    ? ((request.registry.metadata as Record<string, unknown>)
                          .serverName as string)
                    : undefined;
            const serverName = serverConfig?.name ?? metadataServerName;
            const args = resolveMCPArgs(request);

            let result: unknown;
            if (serverName) {
                result = await this.adapter.executeTool(
                    request.tool.toolName,
                    args,
                    serverName,
                );
            } else {
                result = await this.adapter.executeTool(
                    request.tool.toolName,
                    args,
                );
            }

            return {
                success: true,
                output: result as Record<string, unknown> | string | null,
                latencyMs: Date.now() - startedAt,
            };
        } catch (error) {
            return {
                success: false,
                latencyMs: Date.now() - startedAt,
                error: {
                    message:
                        error instanceof Error ? error.message : String(error),
                },
            };
        }
    }
}

@Injectable()
export class CodeReviewContextPackService {
    constructor(
        private readonly contextReferenceService: ContextReferenceService,
        private readonly mcpToolMetadataService: MCPToolMetadataService,
        private readonly logger: PinoLoggerService,
        private readonly mcpToolArgResolver: MCPToolArgResolverAgentService,
    ) {}

    /**
     * Monta o `ContextPack` com as instruções do usuário, camadas externas e
     * execuções MCP necessárias para o review.
     */
    async buildContextPack(params: BuildPackParams): Promise<BuildPackResult> {
        const { organizationAndTeamData, contextReferenceId, overrides } =
            params;

        // NÃO sanitiza ainda - vamos substituir os marcadores MCP primeiro
        // depois sanitiza o que sobrou (se necessário)
        let processedOverrides = overrides
            ? (JSON.parse(
                  JSON.stringify(overrides),
              ) as CodeReviewConfig['v2PromptOverrides'])
            : undefined;

        if (!contextReferenceId || !organizationAndTeamData?.organizationId) {
            // Se não tem contexto, sanitiza e retorna
            return {
                sanitizedOverrides: this.sanitizeOverrides(processedOverrides),
            };
        }

        const reference =
            await this.contextReferenceService.findById(contextReferenceId);

        if (!reference) {
            return {
                sanitizedOverrides: this.sanitizeOverrides(processedOverrides),
            };
        }

        const requirements = reference.requirements ?? [];
        const dependencies = this.buildDependencies(requirements);
        const hasPackContent =
            Boolean(processedOverrides) ||
            dependencies.length > 0 ||
            (params.externalLayers?.length ?? 0) > 0;

        if (!hasPackContent) {
            return {
                sanitizedOverrides: this.sanitizeOverrides(processedOverrides),
            };
        }

        // Carrega metadata e resolve dependencies ANTES de executar tools
        const metadataLoad = dependencies.length
            ? await this.mcpToolMetadataService.loadMetadataForOrganization(
                  organizationAndTeamData,
              )
            : {
                  connections: [] as MCPServerConfig[],
                  metadata: new Map<string, MCPToolMetadata>(),
              };

        const connections = metadataLoad.connections;
        const metadata = metadataLoad.metadata;

        // Cria pack temporário para resolução de dependencies
        const tempPack = await this.assemblePackFromPipeline({
            contextReferenceId,
            instructionsLayer: processedOverrides
                ? this.createInstructionsLayer(
                      contextReferenceId,
                      processedOverrides,
                  )
                : undefined,
            externalLayers: params.externalLayers,
        });

        const { resolvedDependencies } =
            await this.resolveMCPDependenciesForPack({
                dependencies,
                pack: tempPack,
                organizationAndTeamData,
                toolMetadata: metadata,
            });

        // Executa tools e substitui marcadores ANTES de criar o pack final
        let augmentations: ContextAugmentationsMap | undefined;
        if (resolvedDependencies.length > 0 && connections?.length > 0) {
            const { augmentations: execAugmentations } =
                await this.executeDependencies({
                    contextReferenceId,
                    connections,
                    dependencies: resolvedDependencies,
                    pack: tempPack,
                });

            augmentations = execAugmentations;

            // Substitui marcadores MCP pelos resultados das tools nos overrides
            if (augmentations && Object.keys(augmentations).length > 0) {
                this.logger.debug({
                    message: 'MCP marker replacement: starting replacement',
                    context: CodeReviewContextPackService.name,
                    metadata: {
                        augmentationsKeys: Object.keys(augmentations),
                        dependenciesCount: resolvedDependencies.length,
                        hasProcessedOverrides: !!processedOverrides,
                    },
                });

                processedOverrides = this.replaceMCPMarkersInOverrides(
                    processedOverrides,
                    augmentations,
                    resolvedDependencies,
                );

                this.logger.debug({
                    message: 'MCP marker replacement: replacement completed',
                    context: CodeReviewContextPackService.name,
                    metadata: {
                        resultStringified: JSON.stringify(
                            processedOverrides,
                        ).substring(0, 500),
                    },
                });
            }
        }

        // Agora cria o pack FINAL com os overrides já substituídos
        const instructionsLayer = this.createInstructionsLayer(
            contextReferenceId,
            processedOverrides,
        );

        const pack = await this.assemblePackFromPipeline({
            contextReferenceId,
            instructionsLayer,
            externalLayers: params.externalLayers,
        });

        // Garante que dependencies sempre seja um array (mesmo que vazio)
        pack.dependencies =
            resolvedDependencies.length > 0 ? resolvedDependencies : [];
        pack.metadata = {
            ...(pack.metadata ?? {}),
            contextReferenceId,
            requirementIds: requirements.map((req) => req.id),
        };

        if (augmentations && Object.keys(augmentations).length > 0) {
            pack.layers.push(
                this.createAugmentationsLayer(
                    contextReferenceId,
                    augmentations,
                ),
            );
        }

        // NÃO sanitiza depois - os marcadores já foram substituídos ou mantidos
        // Se ainda houver marcadores não resolvidos, eles serão mantidos (não removidos)
        const sanitizedOverrides = processedOverrides;

        return {
            sanitizedOverrides,
            augmentations,
            pack,
        };
    }

    /**
     * Remove marcadores e campos vazios dos overrides antes de inseri-los no pack.
     * NÃO remove nós mcpMention do TipTap JSON - esses serão substituídos depois.
     */
    private sanitizeOverrides(
        overrides?: CodeReviewConfig['v2PromptOverrides'],
    ): CodeReviewConfig['v2PromptOverrides'] | undefined {
        if (!overrides) {
            return undefined;
        }

        const clone = JSON.parse(
            JSON.stringify(overrides),
        ) as CodeReviewConfig['v2PromptOverrides'];

        const sanitizeRecursive = (node: unknown): unknown => {
            if (typeof node === 'string') {
                return stripMarkersFromText(node, CODE_REVIEW_CONTEXT_PATTERNS);
            }

            if (Array.isArray(node)) {
                return node.map((item) => sanitizeRecursive(item));
            }

            if (node && typeof node === 'object') {
                const candidate = node as Record<string, unknown>;

                if (candidate.type === 'mcpMention') {
                    return node;
                }

                const result: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(candidate)) {
                    result[key] = sanitizeRecursive(value);
                }
                return result;
            }

            return node;
        };

        return sanitizeRecursive(
            clone,
        ) as CodeReviewConfig['v2PromptOverrides'];
    }

    private replaceMCPMarkersInOverrides(
        overrides: CodeReviewConfig['v2PromptOverrides'] | undefined,
        augmentations: ContextAugmentationsMap,
        dependencies: ContextDependency[],
    ): CodeReviewConfig['v2PromptOverrides'] | undefined {
        if (!overrides) {
            return undefined;
        }

        const clone = JSON.parse(
            JSON.stringify(overrides),
        ) as CodeReviewConfig['v2PromptOverrides'];

        const dependencyMap = new Map<string, ContextDependency>();
        for (const dep of dependencies) {
            const provider = this.resolveProvider(dep);
            const toolName = this.resolveToolName(dep);
            if (provider && toolName) {
                dependencyMap.set(`${provider}|${toolName}`, dep);
            }
        }

        const { resultsMap, errorsMap } = this.buildToolResultMaps(
            augmentations,
            dependencyMap,
        );

        const lookup = (provider: string, tool: string) => {
            const normalized = this.normalizeProviderToolKey(provider, tool);

            let result = resultsMap.get(normalized);
            let error = errorsMap.get(normalized);

            if (result || error) {
                return { result, error };
            }

            const dep =
                dependencyMap.get(normalized) ??
                dependencyMap.get(`${provider}|${tool}`);

            if (dep) {
                const providerAlias = dep.metadata?.providerAlias as
                    | string
                    | undefined;
                const toolNameAlias = dep.metadata?.toolNameAlias as
                    | string
                    | undefined;

                const aliasKeys = this.generateNormalizedKeys(
                    provider,
                    tool,
                    providerAlias,
                    toolNameAlias,
                );

                for (const key of aliasKeys) {
                    result = resultsMap.get(key);
                    error = errorsMap.get(key);
                    if (result || error) {
                        return { result, error };
                    }
                }

                const realProvider = this.resolveProvider(dep);
                const realToolName = this.resolveToolName(dep);
                if (realProvider && realToolName) {
                    const realKey = this.normalizeProviderToolKey(
                        realProvider,
                        realToolName,
                    );
                    result = resultsMap.get(realKey);
                    error = errorsMap.get(realKey);
                    if (result || error) {
                        return { result, error };
                    }
                }
            }

            return { result: undefined, error: undefined };
        };

        const replaceRecursive = (node: unknown): unknown => {
            if (typeof node === 'string') {
                const parsed = this.tryParseJSON(node);
                if (parsed !== null) {
                    const processed = replaceRecursive(parsed);
                    if (processed !== parsed) {
                        return JSON.stringify(processed);
                    }
                }
                return this.replaceMarkersInString(node, lookup);
            }

            if (Array.isArray(node)) {
                const replaced: unknown[] = [];
                for (const item of node) {
                    if (
                        item &&
                        typeof item === 'object' &&
                        (item as Record<string, unknown>).type === 'mcpMention'
                    ) {
                        const replacedNode = this.replaceMCPMentionNode(
                            item as Record<string, unknown>,
                            lookup,
                        );
                        if (
                            replacedNode !== null &&
                            replacedNode !== undefined
                        ) {
                            replaced.push(replacedNode);
                        }
                        continue;
                    }
                    const replacedItem = replaceRecursive(item);
                    if (replacedItem !== null && replacedItem !== undefined) {
                        replaced.push(replacedItem);
                    }
                }
                return replaced;
            }

            if (node && typeof node === 'object') {
                const candidate = node as Record<string, unknown>;

                if (candidate.type === 'mcpMention') {
                    return this.replaceMCPMentionNode(candidate, lookup);
                }

                const result: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(candidate)) {
                    const replaced = replaceRecursive(value);
                    if (replaced !== null && replaced !== undefined) {
                        result[key] = replaced;
                    }
                }
                return result;
            }

            return node;
        };

        return replaceRecursive(clone) as CodeReviewConfig['v2PromptOverrides'];
    }

    private tryParseJSON(str: string): unknown | null {
        if (!str || typeof str !== 'string') {
            return null;
        }

        const trimmed = str.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return null;
        }

        try {
            return JSON.parse(str);
        } catch {
            return null;
        }
    }

    private normalizeProviderToolKey(provider: string, tool: string): string {
        return `${provider.toLowerCase().trim()}|${tool.toLowerCase().trim()}`;
    }

    private generateNormalizedKeys(
        provider: string,
        toolName: string,
        providerAlias?: string,
        toolNameAlias?: string,
    ): Set<string> {
        const keys = new Set<string>();

        keys.add(this.normalizeProviderToolKey(provider, toolName));

        if (providerAlias) {
            keys.add(this.normalizeProviderToolKey(providerAlias, toolName));
        }

        if (toolNameAlias) {
            keys.add(this.normalizeProviderToolKey(provider, toolNameAlias));
        }

        if (providerAlias && toolNameAlias) {
            keys.add(
                this.normalizeProviderToolKey(providerAlias, toolNameAlias),
            );
        }

        return keys;
    }

    private buildToolResultMaps(
        augmentations: ContextAugmentationsMap,
        dependencyMap: Map<string, ContextDependency>,
    ): {
        resultsMap: Map<string, string>;
        errorsMap: Map<string, string>;
    } {
        const resultsMap = new Map<string, string>();
        const errorsMap = new Map<string, string>();

        for (const augmentation of Object.values(augmentations)) {
            for (const output of augmentation.outputs) {
                if (!output.provider || !output.toolName) {
                    continue;
                }

                const normalizedKey = this.normalizeProviderToolKey(
                    output.provider,
                    output.toolName,
                );
                const dep =
                    dependencyMap.get(normalizedKey) ??
                    dependencyMap.get(`${output.provider}|${output.toolName}`);

                const providerAlias = dep?.metadata?.providerAlias as
                    | string
                    | undefined;
                const toolNameAlias = dep?.metadata?.toolNameAlias as
                    | string
                    | undefined;

                const keys = this.generateNormalizedKeys(
                    output.provider,
                    output.toolName,
                    providerAlias,
                    toolNameAlias,
                );

                if (output.success && output.output) {
                    for (const key of keys) {
                        resultsMap.set(key, output.output);
                    }
                } else if (output.error) {
                    for (const key of keys) {
                        errorsMap.set(key, output.error);
                    }
                }
            }
        }

        return { resultsMap, errorsMap };
    }

    private replaceMarkersInString(
        text: string,
        lookup: (
            provider: string,
            tool: string,
        ) => {
            result?: string;
            error?: string;
        },
    ): string {
        const markerRegex = /@mcp<([^|>]+)\|([^>]+)>/gi;
        const matches: Array<{
            marker: string;
            provider: string;
            tool: string;
        }> = [];

        let match: RegExpExecArray | null;
        while ((match = markerRegex.exec(text)) !== null) {
            matches.push({
                marker: match[0],
                provider: match[1].trim(),
                tool: match[2].trim(),
            });
        }

        if (matches.length > 0) {
            this.logger.debug({
                message: 'MCP marker replacement: found markers in string',
                context: CodeReviewContextPackService.name,
                metadata: {
                    matchesCount: matches.length,
                    matches: matches.map((m) => ({
                        marker: m.marker,
                        provider: m.provider,
                        tool: m.tool,
                    })),
                },
            });
        }

        let result = text;
        for (let i = matches.length - 1; i >= 0; i--) {
            const { marker, provider, tool } = matches[i];
            const normalized = this.normalizeProviderToolKey(provider, tool);
            const { result: replacement, error } = lookup(provider, tool);

            this.logger.debug({
                message: 'MCP marker replacement: attempting lookup',
                context: CodeReviewContextPackService.name,
                metadata: {
                    marker,
                    provider,
                    tool,
                    normalized,
                    foundResult: !!replacement,
                    foundError: !!error,
                },
            });

            if (replacement) {
                result = result.replace(marker, replacement);
                this.logger.debug({
                    message: 'MCP marker replacement: SUCCESS',
                    context: CodeReviewContextPackService.name,
                    metadata: {
                        marker,
                        provider,
                        tool,
                        replacementLength: replacement.length,
                    },
                });
            } else if (error) {
                result = result.replace(
                    marker,
                    `[MCP Tool ${tool} failed: ${error}]`,
                );
            }
        }

        return result;
    }

    private replaceMCPMentionNode(
        node: Record<string, unknown>,
        lookup: (
            provider: string,
            tool: string,
        ) => {
            result?: string;
            error?: string;
        },
    ): unknown {
        const attrs = node.attrs as Record<string, unknown> | undefined;
        const provider = typeof attrs?.app === 'string' ? attrs.app : undefined;
        const toolName =
            typeof attrs?.tool === 'string' ? attrs.tool : undefined;

        if (!provider || !toolName) {
            return node;
        }

        const normalized = this.normalizeProviderToolKey(provider, toolName);
        const { result, error } = lookup(provider, toolName);

        this.logger.debug({
            message: 'MCP marker replacement: processing mcpMention node',
            context: CodeReviewContextPackService.name,
            metadata: {
                provider,
                toolName,
                normalized,
                foundResult: !!result,
                foundError: !!error,
            },
        });

        if (result) {
            this.logger.debug({
                message: 'MCP marker replacement: SUCCESS (rich text)',
                context: CodeReviewContextPackService.name,
                metadata: {
                    provider,
                    toolName,
                    resultLength: result.length,
                },
            });
            return { type: 'text', text: result };
        }

        if (error) {
            return {
                type: 'text',
                text: `[MCP Tool ${toolName} failed: ${error}]`,
            };
        }

        return node;
    }

    private buildDependencies(
        requirements: ContextRequirement[],
    ): ContextDependency[] {
        const dependencies: ContextDependency[] = [];
        const dedupe = new Set<string>();

        for (const requirement of requirements) {
            const path = this.resolveRequirementPath(requirement);
            const pathKey = pathToKey(path);

            for (const dependency of requirement.dependencies ?? []) {
                if (!dependency || dependency.type !== 'mcp') {
                    continue;
                }

                const { provider, toolName, args } =
                    this.parseDependency(dependency);
                if (!provider || !toolName) {
                    continue;
                }

                const uniqueKey = `${pathKey}::${provider}::${toolName}`;
                if (dedupe.has(uniqueKey)) {
                    continue;
                }
                dedupe.add(uniqueKey);

                const metadata = {
                    ...(dependency.metadata ?? {}),
                    provider,
                    toolName,
                    path,
                    pathKey,
                    requirementId: requirement.id,
                    ...(args ? { args } : {}),
                };

                const descriptor = this.buildDescriptor(
                    dependency.descriptor,
                    provider,
                    toolName,
                    metadata,
                );

                dependencies.push({
                    type: 'mcp',
                    id: `${provider}|${toolName}`,
                    descriptor,
                    metadata,
                });
            }
        }

        return dependencies;
    }

    private buildDescriptor(
        currentDescriptor: unknown,
        provider: string,
        toolName: string,
        metadata: Record<string, unknown>,
    ): unknown {
        if (
            currentDescriptor &&
            typeof currentDescriptor === 'object' &&
            isPlainObject(currentDescriptor) &&
            typeof (currentDescriptor as Record<string, unknown>).mcpId ===
                'string' &&
            typeof (currentDescriptor as Record<string, unknown>).toolName ===
                'string'
        ) {
            const descriptor = currentDescriptor as Record<string, unknown>;
            const existingMetadata = isPlainObject(descriptor.metadata)
                ? (descriptor.metadata as Record<string, unknown>)
                : {};
            return {
                ...descriptor,
                mcpId: provider,
                toolName,
                metadata: {
                    ...existingMetadata,
                    ...metadata,
                },
            };
        }

        return {
            mcpId: provider,
            toolName,
            metadata,
        };
    }

    private async resolveMCPDependenciesForPack(params: {
        dependencies: ContextDependency[];
        pack: ContextPack;
        organizationAndTeamData?: OrganizationAndTeamData;
        toolMetadata: Map<string, MCPToolMetadata>;
    }): Promise<{
        resolvedDependencies: ContextDependency[];
        skippedDependencies: SkippedMCPTool[];
    }> {
        const { dependencies, pack, organizationAndTeamData, toolMetadata } =
            params;
        const resolvedDependencies: ContextDependency[] = [];
        const skippedDependencies: SkippedMCPTool[] = [];

        for (const dependency of dependencies) {
            try {
                const enrichedDependency = this.applyToolMetadata(
                    dependency,
                    toolMetadata,
                );

                const resolution = await this.mcpToolArgResolver.resolveArgs({
                    dependency: enrichedDependency,
                    organizationAndTeamData,
                    pack,
                    input: DEFAULT_LAYER_INPUT,
                    runtime: undefined,
                });

                if (resolution.missingArgs.length === 0) {
                    const resolvedDependency: ContextDependency = {
                        ...enrichedDependency,
                        metadata: {
                            ...(enrichedDependency.metadata ?? {}),
                            args: resolution.args,
                            argsSources: {
                                _agent: `resolved with confidence ${resolution.confidence}`,
                            },
                        },
                    };
                    resolvedDependencies.push(resolvedDependency);
                    continue;
                }

                const provider = this.resolveProvider(enrichedDependency);
                const toolName = this.resolveToolName(enrichedDependency);
                const requirementId =
                    this.resolveRequirementId(enrichedDependency);
                const path = this.resolveDependencyPath(enrichedDependency);

                const message = `MCP tool ${provider ?? 'unknown'}::${
                    toolName ?? 'unknown'
                } not executed. Missing arguments: ${
                    resolution.missingArgs.join(', ') || 'unknown'
                }. Confidence: ${resolution.confidence.toFixed(2)}`;

                this.logger.warn({
                    message,
                    context: CodeReviewContextPackService.name,
                    metadata: {
                        provider,
                        toolName,
                        requirementId,
                        missingArgs: resolution.missingArgs,
                        path,
                        confidence: resolution.confidence,
                        severity: 'warning',
                    },
                });

                skippedDependencies.push({
                    provider,
                    toolName,
                    requirementId,
                    path,
                    missingArgs: resolution.missingArgs,
                    message,
                });
            } catch (error) {
                const provider = this.resolveProvider(dependency);
                const toolName = this.resolveToolName(dependency);

                this.logger.error({
                    message:
                        'Error resolving arguments for MCP tool before execution',
                    context: CodeReviewContextPackService.name,
                    error,
                    metadata: {
                        provider,
                        toolName,
                        requirementId: this.resolveRequirementId(dependency),
                    },
                });

                skippedDependencies.push({
                    provider,
                    toolName,
                    requirementId: this.resolveRequirementId(dependency),
                    path: this.resolveDependencyPath(dependency),
                    missingArgs: [],
                    message:
                        'Internal failure while preparing arguments for MCP tool.',
                });
            }
        }

        return { resolvedDependencies, skippedDependencies };
    }

    private resolveConnectionProviderId(
        connection: MCPServerConfig,
    ): string | undefined {
        const candidates = [
            connection.provider,
            connection.name,
            connection.url,
        ];

        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate.trim();
            }
        }

        return undefined;
    }

    private applyToolMetadata(
        dependency: ContextDependency,
        metadataMap: Map<string, MCPToolMetadata>,
    ): ContextDependency {
        const provider = this.resolveProvider(dependency);
        const toolName = this.resolveToolName(dependency);

        if (!provider || !toolName) {
            return dependency;
        }

        const metadataEntry = this.mcpToolMetadataService.resolveToolMetadata(
            metadataMap,
            provider,
            toolName,
        );
        const resolvedProvider = metadataEntry?.providerId ?? provider;
        const resolvedToolName = metadataEntry?.toolName ?? toolName;
        const metadata = metadataEntry?.metadata;

        if (!metadata) {
            return {
                ...dependency,
                id: `${resolvedProvider}|${resolvedToolName}`,
                metadata: {
                    ...(dependency.metadata ?? {}),
                    provider: resolvedProvider,
                    toolName: resolvedToolName,
                    ...(resolvedProvider !== provider
                        ? { providerAlias: provider }
                        : {}),
                    ...(resolvedToolName !== toolName
                        ? { toolNameAlias: toolName }
                        : {}),
                },
            };
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
            resolvedProvider &&
            provider &&
            resolvedProvider !== provider &&
            !mergedMetadata.providerAlias
        ) {
            mergedMetadata.providerAlias = provider;
        }

        if (
            resolvedToolName &&
            toolName &&
            resolvedToolName !== toolName &&
            !mergedMetadata.toolNameAlias
        ) {
            mergedMetadata.toolNameAlias = toolName;
        }

        let descriptor = dependency.descriptor;
        if (descriptor && typeof descriptor === 'object') {
            const descriptorRecord = descriptor as Record<string, unknown>;
            descriptor = {
                ...descriptorRecord,
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

    private async executeDependencies(params: {
        contextReferenceId: string;
        connections: MCPServerConfig[];
        dependencies: ContextDependency[];
        pack: ContextPack;
    }): Promise<{ augmentations?: ContextAugmentationsMap }> {
        const { contextReferenceId, connections, dependencies, pack } = params;

        if (!dependencies.length) {
            return {};
        }

        const adapter = createMCPAdapter({
            servers: connections.map((connection) => ({
                ...connection,
                timeout: connection.timeout ?? 10_000,
                retries: connection.retries ?? 1,
            })),
            defaultTimeout: 10_000,
            maxRetries: 1,
            onError: (error, serverName) => {
                this.logger.warn({
                    message: 'MCP adapter error during context execution',
                    context: CodeReviewContextPackService.name,
                    error,
                    metadata: { serverName },
                });
            },
        });

        const connectionById = new Map<string, MCPServerConfig>();
        const registry = new InMemoryMCPRegistry();

        const requiredToolsByProvider = new Map<string, Set<string>>();
        for (const dependency of dependencies) {
            const provider = this.resolveProvider(dependency)?.trim();
            const toolName = this.resolveToolName(dependency)?.trim();
            if (!provider || !toolName) {
                continue;
            }

            if (!requiredToolsByProvider.has(provider)) {
                requiredToolsByProvider.set(provider, new Set());
            }
            requiredToolsByProvider.get(provider)!.add(toolName);
        }

        for (const connection of connections) {
            const providerId = this.resolveConnectionProviderId(connection);

            if (!providerId) {
                continue;
            }

            connectionById.set(providerId, connection);

            const requiredTools =
                requiredToolsByProvider.get(providerId) ?? new Set<string>();
            const toolsToRegister =
                requiredTools.size > 0
                    ? Array.from(requiredTools)
                    : Array.from(connection.allowedTools ?? []);

            registry.register({
                id: providerId,
                title: connection.name ?? providerId,
                endpoint: connection.url ?? '',
                description: connection.name ?? providerId,
                status: 'available',
                tools: toolsToRegister.map((toolName) => ({
                    mcpId: providerId,
                    toolName,
                    metadata: {},
                })),
                metadata: {
                    serverName: connection.name ?? providerId,
                    provider: connection.provider ?? providerId,
                },
            } satisfies MCPRegistration);
        }

        const client = new AdapterBackedMCPClient(adapter, connectionById);

        const orchestrator = new MCPOrchestrator(registry, client, {
            logger: {
                debug: (message, meta) =>
                    this.logger.debug({
                        message,
                        context: CodeReviewContextPackService.name,
                        metadata: meta,
                    }),
                info: (message, meta) =>
                    this.logger.log({
                        message,
                        context: CodeReviewContextPackService.name,
                        metadata: meta,
                    }),
                warn: (message, meta) =>
                    this.logger.warn({
                        message,
                        context: CodeReviewContextPackService.name,
                        metadata: meta,
                    }),
                error: (message, meta) =>
                    this.logger.error({
                        message,
                        context: CodeReviewContextPackService.name,
                        metadata: meta,
                    }),
            },
        });

        const dependencyIndex = this.buildDependencyIndex(dependencies);
        const augmentations: ContextAugmentationsMap = {};

        try {
            await adapter.connect();

            const report = await orchestrator.executeRequiredTools({
                pack,
                input: DEFAULT_LAYER_INPUT,
                dependencies,
            });

            for (const record of report.results) {
                const metadata = (record.tool.metadata ?? {}) as Record<
                    string,
                    unknown
                >;

                const provider =
                    (metadata.provider as string | undefined) ??
                    record.tool.mcpId;
                const toolName = record.tool.toolName;
                const pathKey =
                    (metadata.pathKey as string | undefined) ??
                    (Array.isArray(metadata.path)
                        ? pathToKey(metadata.path as string[])
                        : undefined);
                const key = this.buildAugmentationKey(
                    pathKey,
                    provider,
                    toolName,
                );

                if (!key) {
                    continue;
                }

                const dependencyMeta = dependencyIndex.get(key);
                if (!dependencyMeta) {
                    continue;
                }

                if (!augmentations[dependencyMeta.pathKey]) {
                    augmentations[dependencyMeta.pathKey] = {
                        path: dependencyMeta.path,
                        requirementId: dependencyMeta.requirementId,
                        outputs: [],
                    };
                }

                const outputEntry: ContextAugmentationOutput = {
                    provider: dependencyMeta.provider,
                    toolName: dependencyMeta.toolName,
                    success: record.result?.success ?? false,
                };

                if (record.result?.success) {
                    outputEntry.output = this.formatToolOutput(
                        record.result.output,
                    );
                } else if (record.result?.error?.message) {
                    outputEntry.error = record.result.error.message;
                } else if (record.error) {
                    outputEntry.error = record.error;
                }

                augmentations[dependencyMeta.pathKey].outputs.push(outputEntry);
            }
        } catch (error) {
            this.logger.error({
                message:
                    'Failed to execute context dependencies via MCP orchestrator',
                context: CodeReviewContextPackService.name,
                error,
                metadata: {
                    contextReferenceId,
                },
            });
        } finally {
            try {
                await adapter.disconnect();
            } catch (error) {
                this.logger.warn({
                    message:
                        'Failed to disconnect MCP adapter after orchestrator run',
                    context: CodeReviewContextPackService.name,
                    error,
                });
            }
        }

        return {
            augmentations: Object.keys(augmentations).length
                ? augmentations
                : undefined,
        };
    }

    private async assemblePackFromPipeline(params: {
        contextReferenceId: string;
        instructionsLayer?: ContextLayer;
        externalLayers?: ContextLayer[];
    }): Promise<ContextPack> {
        const steps: PackAssemblyStep[] = [];

        if (params.instructionsLayer) {
            const snapshot = this.cloneLayer(params.instructionsLayer);
            steps.push({
                description: 'Code review instructions',
                builder: new StaticLayerBuilder(() =>
                    this.cloneLayer(snapshot),
                ),
            });
        }

        const pipeline = new SequentialPackAssemblyPipeline({
            steps,
            createdBy: 'code-review-context-pack',
            packIdFactory: () => `code-review:${params.contextReferenceId}`,
            versionFactory: () => '1.0.0',
        });

        const input: LayerInputContext = {
            domain: DEFAULT_LAYER_INPUT.domain,
            taskIntent: DEFAULT_LAYER_INPUT.taskIntent,
            retrieval: {
                candidates: [],
                diagnostics: {},
            },
            metadata: {
                contextReferenceId: params.contextReferenceId,
            },
        };

        const { pack } = await pipeline.execute(input);

        if (params.externalLayers?.length) {
            for (const layer of params.externalLayers) {
                pack.layers.push(this.cloneLayer(layer));
            }
        }

        return pack;
    }

    private createInstructionsLayer(
        contextReferenceId: string,
        overrides?: CodeReviewConfig['v2PromptOverrides'],
    ): ContextLayer | undefined {
        if (!overrides) {
            return undefined;
        }

        return {
            id: `${contextReferenceId}::instructions`,
            kind: 'core',
            priority: 1,
            tokens: 0,
            content: this.deepClone(overrides),
            references: [],
            metadata: {
                contextReferenceId,
            },
        };
    }

    private buildDependencyIndex(dependencies: ContextDependency[]): Map<
        string,
        {
            pathKey: string;
            path: string[];
            requirementId?: string;
            provider?: string;
            toolName: string;
        }
    > {
        const index = new Map<
            string,
            {
                pathKey: string;
                path: string[];
                requirementId?: string;
                provider?: string;
                toolName: string;
            }
        >();

        for (const dependency of dependencies) {
            const provider = this.resolveProvider(dependency);
            const toolName = this.resolveToolName(dependency);
            const path = this.resolveDependencyPath(dependency);
            const pathKey = this.resolveDependencyPathKey(dependency);

            if (!toolName || !pathKey) {
                continue;
            }

            const key = this.buildAugmentationKey(pathKey, provider, toolName);
            if (!key) {
                continue;
            }

            index.set(key, {
                pathKey,
                path,
                requirementId: this.resolveRequirementId(dependency),
                provider,
                toolName,
            });
        }

        return index;
    }

    private createAugmentationsLayer(
        contextReferenceId: string,
        augmentations: ContextAugmentationsMap,
    ): ContextLayer {
        return {
            id: `${contextReferenceId}::augmentations`,
            kind: 'metadata',
            priority: 1,
            tokens: 0,
            content: augmentations,
            references: [],
            metadata: {
                contextReferenceId,
            },
        };
    }

    private resolveRequirementPath(requirement: ContextRequirement): string[] {
        if (
            Array.isArray(requirement.metadata?.path) &&
            requirement.metadata.path.every(
                (segment) => typeof segment === 'string',
            )
        ) {
            return requirement.metadata.path as string[];
        }

        return this.derivePathFromRequirementId(requirement.id);
    }

    private resolveDependencyPath(dependency: ContextDependency): string[] {
        if (
            Array.isArray(dependency.metadata?.path) &&
            dependency.metadata.path.every(
                (segment) => typeof segment === 'string',
            )
        ) {
            return dependency.metadata.path as string[];
        }

        const requirementId = this.resolveRequirementId(dependency);
        if (requirementId) {
            return this.derivePathFromRequirementId(requirementId);
        }

        return [];
    }

    private resolveDependencyPathKey(
        dependency: ContextDependency,
    ): string | undefined {
        if (typeof dependency.metadata?.pathKey === 'string') {
            return dependency.metadata.pathKey as string;
        }

        const path = this.resolveDependencyPath(dependency);
        return path.length ? pathToKey(path) : undefined;
    }

    private resolveRequirementId(
        dependency: ContextDependency,
    ): string | undefined {
        if (typeof dependency.metadata?.requirementId === 'string') {
            return dependency.metadata.requirementId as string;
        }
        return undefined;
    }

    private derivePathFromRequirementId(id: string): string[] {
        if (!id.includes('#')) {
            return [id];
        }

        const [, tail] = id.split('#');
        return tail.split('.');
    }

    private parseDependency(dependency: ContextDependency): {
        provider?: string;
        toolName?: string;
        args?: Record<string, unknown>;
    } {
        const metadata = dependency.metadata ?? {};

        const provider =
            (typeof metadata.provider === 'string'
                ? (metadata.provider as string)
                : undefined) ??
            (typeof metadata.mcpId === 'string'
                ? (metadata.mcpId as string)
                : undefined) ??
            dependency.id.split('|')[0];

        const toolName =
            (typeof metadata.toolName === 'string'
                ? (metadata.toolName as string)
                : undefined) ??
            (typeof metadata.tool === 'string'
                ? (metadata.tool as string)
                : undefined) ??
            dependency.id.split('|')[1];

        const args =
            metadata.args && isPlainObject(metadata.args)
                ? (metadata.args as Record<string, unknown>)
                : undefined;

        return { provider, toolName, args };
    }

    private resolveProvider(dependency: ContextDependency): string | undefined {
        const metadata = dependency.metadata ?? {};
        if (typeof metadata.provider === 'string') {
            return metadata.provider as string;
        }
        if (typeof metadata.mcpId === 'string') {
            return metadata.mcpId as string;
        }
        const [provider] = dependency.id.split('|', 2);
        return provider || undefined;
    }

    private resolveToolName(dependency: ContextDependency): string | undefined {
        const metadata = dependency.metadata ?? {};
        if (typeof metadata.toolName === 'string') {
            return metadata.toolName as string;
        }
        if (typeof metadata.tool === 'string') {
            return metadata.tool as string;
        }
        const [, toolName] = dependency.id.split('|', 2);
        return toolName || undefined;
    }

    private buildAugmentationKey(
        pathKey?: string,
        provider?: string,
        toolName?: string,
    ): string | undefined {
        if (!pathKey || !toolName) {
            return undefined;
        }
        const providerKey = provider ?? 'default';
        return `${pathKey}::${providerKey}::${toolName}`;
    }

    private formatToolOutput(result: unknown): string {
        if (result === null || result === undefined) {
            return 'No output returned.';
        }

        if (typeof result === 'string') {
            return this.truncate(result);
        }

        try {
            return this.truncate(JSON.stringify(result, null, 2));
        } catch {
            return this.truncate(String(result));
        }
    }

    private truncate(value: string, max = MAX_TOOL_OUTPUT_LENGTH): string {
        if (value.length <= max) {
            return value;
        }
        return `${value.slice(0, max)}…`;
    }

    private cloneLayer(layer: ContextLayer): ContextLayer {
        return {
            ...layer,
            content: this.deepClone(layer.content),
            references: layer.references.map((ref) => ({ ...ref })),
            metadata: layer.metadata
                ? this.deepClone(layer.metadata)
                : undefined,
        };
    }

    private deepClone<T>(value: T): T {
        if (value === null || value === undefined) {
            return value;
        }

        try {
            return JSON.parse(JSON.stringify(value)) as T;
        } catch {
            return value;
        }
    }
}
