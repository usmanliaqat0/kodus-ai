import type {
    AgentIdentity,
    ContextLayer,
    ContextLayerBuilder,
    ContextLayerKind,
    LayerBuildDiagnostics,
    LayerBuildOptions,
    LayerBuildResult,
    LayerInputContext,
    LayerResidence,
    ToolDescriptor,
} from '../interfaces.js';

import {
    allocateEntries,
    ensureEstimator,
    LayerEntry,
    summarizeDropped,
    TokenEstimator,
} from './token-utils.js';

export interface CoreLayerInstruction {
    id: string;
    text: string;
    critical?: boolean;
    metadata?: Record<string, unknown>;
}

export interface CoreLayerConstraint {
    id: string;
    text: string;
    critical?: boolean;
    metadata?: Record<string, unknown>;
}

export interface CoreLayerMaterial {
    persona?: AgentIdentity;
    instructions: CoreLayerInstruction[];
    constraints?: CoreLayerConstraint[];
    checklists?: string[];
    toolset?: ToolDescriptor[];
    notes?: string[];
    references?: Array<{ itemId: string; sliceId?: string }>;
    metadata?: Record<string, unknown>;
}

export interface CoreLayerMaterializer {
    materialize(input: LayerInputContext): Promise<CoreLayerMaterial>;
}

export interface CoreLayerBuilderConfig {
    materializer: CoreLayerMaterializer;
    tokenEstimator?: TokenEstimator;
    defaultResidence?: LayerResidence;
    defaultPriority?: number;
    layerIdFactory?: (input: LayerInputContext) => string | undefined;
}

export class CoreLayerBuilder implements ContextLayerBuilder {
    readonly stage = 'core' as Extract<
        ContextLayerKind,
        'core' | 'catalog' | 'active'
    >;

    private readonly estimator: TokenEstimator;
    private readonly defaultResidence: LayerResidence;
    private readonly defaultPriority: number;

    constructor(private readonly config: CoreLayerBuilderConfig) {
        this.estimator = ensureEstimator(config.tokenEstimator);
        this.defaultResidence = config.defaultResidence ?? 'resident';
        this.defaultPriority = config.defaultPriority ?? 100;
    }

    async build(
        input: LayerInputContext,
        options?: LayerBuildOptions,
    ): Promise<LayerBuildResult> {
        const material = await this.config.materializer.materialize(input);
        const entries: LayerEntry<
            CoreLayerInstruction | CoreLayerConstraint | string
        >[] = [];

        for (const instruction of material.instructions ?? []) {
            entries.push({
                category: 'instruction',
                data: instruction,
                tokens: this.estimator.estimateText(instruction.text),
                critical: instruction.critical,
            });
        }

        for (const constraint of material.constraints ?? []) {
            entries.push({
                category: 'constraint',
                data: constraint,
                tokens: this.estimator.estimateText(constraint.text),
                critical: constraint.critical,
            });
        }

        for (const checklist of material.checklists ?? []) {
            entries.push({
                category: 'note',
                data: checklist,
                tokens: this.estimator.estimateText(checklist),
            });
        }

        for (const note of material.notes ?? []) {
            entries.push({
                category: 'note',
                data: note,
                tokens: this.estimator.estimateText(note),
            });
        }

        const limit = options?.maxTokens;
        const { kept, dropped, total } = allocateEntries(entries, limit);
        const instructionsKept = kept
            .filter((entry) => entry.category === 'instruction')
            .map((entry) => entry.data as CoreLayerInstruction);
        const constraintsKept = kept
            .filter((entry) => entry.category === 'constraint')
            .map((entry) => entry.data as CoreLayerConstraint);
        const notesKept = kept
            .filter((entry) => entry.category === 'note')
            .map((entry) => entry.data as string);

        const diagnostics: LayerBuildDiagnostics = {
            tokensBefore: entries.reduce((acc, entry) => acc + entry.tokens, 0),
            tokensAfter: total,
            compactionStrategy: dropped.length ? 'truncate-by-limit' : undefined,
            notes: summarizeDropped(dropped),
        };

        const content = {
            persona: material.persona,
            instructions: instructionsKept.map(({ id, text, metadata }) => ({
                id,
                text,
                metadata,
            })),
            constraints: constraintsKept.map(({ id, text, metadata }) => ({
                id,
                text,
                metadata,
            })),
            notes: notesKept,
            toolset: material.toolset,
        };

        const layer: ContextLayer = {
            id: this.config.layerIdFactory?.(input),
            kind: this.stage,
            priority: options?.priority ?? this.defaultPriority,
            tokens: total,
            residence: options?.residence ?? this.defaultResidence,
            content,
            references: material.references ?? [],
            metadata: {
                ...(material.metadata ?? {}),
                builder: 'core-layer',
                droppedEntries: dropped.length,
            },
        };

        return {
            layer,
            resources: [],
            diagnostics,
        };
    }
}
