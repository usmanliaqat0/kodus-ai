import { randomUUID } from 'crypto';

import type {
    ContextEvent,
    ContextLayer,
    ContextPack,
    ContextResourceRef,
    ContextTelemetry,
    LayerBuildOptions,
    LayerInputContext,
    PackAssemblyPipeline,
    PackAssemblyStep,
    RetrievalQuery,
} from '../interfaces.js';

import { computeBudget } from '../utils/budget.js';

export interface SequentialPipelineTelemetry {
    recorder?: (diagnostics: Record<string, unknown>) => void;
    client?: ContextTelemetry;
    eventFactory?: (params: {
        input: LayerInputContext;
        pack: ContextPack;
        diagnostics: Record<string, unknown>;
    }) => Partial<ContextEvent>;
}

export interface SequentialPipelineConfig {
    steps: PackAssemblyStep[];
    telemetry?: SequentialPipelineTelemetry;
    packIdFactory?: (input: LayerInputContext) => string;
    createdBy?: string;
    versionFactory?: () => string;
}

export class SequentialPackAssemblyPipeline implements PackAssemblyPipeline {
    readonly steps: PackAssemblyStep[];

    private readonly packIdFactory?: (input: LayerInputContext) => string;
    private readonly versionFactory: () => string;
    private readonly createdBy: string;
    private readonly telemetryRecorder?: (diagnostics: Record<string, unknown>) => void;
    private readonly telemetryClient?: ContextTelemetry;
    private readonly telemetryEventFactory?: SequentialPipelineTelemetry['eventFactory'];

    constructor(private readonly config: SequentialPipelineConfig) {
        this.steps = config.steps;
        this.packIdFactory = config.packIdFactory;
        this.versionFactory =
            config.versionFactory ?? (() => new Date().toISOString());
        this.createdBy = config.createdBy ?? 'context-os';
        this.telemetryRecorder = config.telemetry?.recorder;
        this.telemetryClient = config.telemetry?.client;
        this.telemetryEventFactory = config.telemetry?.eventFactory;
    }

    async execute(
        input: LayerInputContext,
        options?: LayerBuildOptions,
    ): Promise<{
        pack: ContextPack;
        resources: ContextResourceRef[];
        diagnostics?: Record<string, unknown>;
    }> {
        const layers: ContextLayer[] = [];
        const resources: ContextResourceRef[] = [];
        const diagnostics: Record<string, unknown> = {
            steps: [] as Array<Record<string, unknown>>,
        };

        for (const step of this.steps) {
            const result = await step.builder.build(input, options);
            layers.push(result.layer);
            resources.push(...(result.resources ?? []));
            (diagnostics.steps as Array<Record<string, unknown>>).push({
                stage: step.builder.stage,
                description: step.description,
                layerTokens: result.layer.tokens,
                diagnostics: result.diagnostics,
            });
        }

        const queryMetadata = (input.metadata?.query ??
            {}) as Partial<RetrievalQuery>;

        const pack: ContextPack = {
            id: this.packIdFactory?.(input) ?? randomUUID(),
            domain: input.domain,
            version: this.versionFactory(),
            createdAt: Date.now(),
            createdBy: this.createdBy,
            budget: computeBudget(options?.maxTokens ?? 8192, layers),
            layers,
            provenance: [],
            constraints: queryMetadata.constraints,
            resources,
            metadata: {
                diagnosticSummary: diagnostics,
                taskIntent: input.taskIntent,
            },
        };

        this.telemetryRecorder?.(diagnostics);

        if (this.telemetryClient) {
            const runtimeUserId =
                input.runtimeContext?.metadata &&
                typeof input.runtimeContext.metadata.userId === 'string'
                    ? (input.runtimeContext.metadata.userId as string)
                    : undefined;

            const baseEvent: ContextEvent = {
                type: 'SELECTION',
                sessionId:
                    input.runtimeContext?.sessionId ?? 'unknown-session',
                tenantId: input.runtimeContext?.tenantId ?? 'unknown-tenant',
                packId: pack.id,
                userId: runtimeUserId,
                budget: pack.budget,
                tokensUsed: pack.budget.usage,
                latencyMs: undefined,
                metadata: {
                    diagnostics,
                    taskIntent: input.taskIntent,
                },
                timestamp: Date.now(),
            };

            const mergedEvent = {
                ...baseEvent,
                ...(this.telemetryEventFactory?.({
                    input,
                    pack,
                    diagnostics,
                }) ?? {}),
            };

            await this.telemetryClient.record(mergedEvent);
        }

        return { pack, resources, diagnostics };
    }
}
