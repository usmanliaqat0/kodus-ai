import type {
    ContextLayer,
    ContextLayerBuilder,
    ContextLayerKind,
    ContextResourceRef,
    LayerBuildDiagnostics,
    LayerBuildOptions,
    LayerBuildResult,
    LayerInputContext,
    LayerResidence,
} from '../interfaces.js';

import {
    allocateEntries,
    ensureEstimator,
    LayerEntry,
    summarizeDropped,
    TokenEstimator,
} from './token-utils.js';

export interface CatalogEntryEntityRef {
    id: string;
    type: string;
    name?: string;
    metadata?: Record<string, unknown>;
}

export interface CatalogEntry {
    id: string;
    title: string;
    summary: string;
    importance?: 'high' | 'medium' | 'low';
    references?: Array<{ itemId: string; sliceId?: string }>;
    entities?: CatalogEntryEntityRef[];
    metadata?: Record<string, unknown>;
}

export interface CatalogLayerMaterial {
    entries: CatalogEntry[];
    insights?: string[];
    runtimeState?: Record<string, unknown>;
    references?: Array<{ itemId: string; sliceId?: string }>;
    resources?: ContextResourceRef[];
    metadata?: Record<string, unknown>;
}

export interface CatalogLayerMaterializer {
    build(input: LayerInputContext): Promise<CatalogLayerMaterial>;
}

export interface CatalogLayerBuilderConfig {
    materializer?: CatalogLayerMaterializer;
    tokenEstimator?: TokenEstimator;
    defaultResidence?: LayerResidence;
    defaultPriority?: number;
    fallbackEntryLimit?: number;
}

function fallbackCatalogEntries(
    retrieval: LayerInputContext['retrieval'],
    limit: number,
    estimator: TokenEstimator,
): CatalogLayerMaterial {
    const candidates = retrieval?.candidates ?? [];
    const limited = candidates.slice(0, limit);
    const entries: CatalogEntry[] = limited.map((candidate, index) => {
        const summary =
            candidate.slices?.map((slice) => slice.summary).join('\n') ??
            candidate.item.payload.text ??
            JSON.stringify(candidate.item.payload.structured ?? candidate.item);

        const tokens = estimator.estimateText(summary);
        const truncatedSummary =
            tokens > 512 ? `${summary.slice(0, 2048)}... (truncated)` : summary;

        return {
            id: `${candidate.item.id}-catalog-${index}`,
            title:
                candidate.item.metadata.title ??
                candidate.item.source.location ??
                candidate.item.id,
            summary: truncatedSummary,
            importance: index === 0 ? 'high' : 'medium',
            references: [{ itemId: candidate.item.id }],
            metadata: {
                score: candidate.score,
                rationale: candidate.rationale,
            },
        };
    });

    return {
        entries,
        insights: limited
            .map((candidate) => candidate.metadata?.reason as string | undefined)
            .filter((value): value is string => Boolean(value)),
        runtimeState: {
            fallback: true,
            candidateCount: candidates.length,
        },
        references: limited.map((candidate) => ({ itemId: candidate.item.id })),
    };
}

export class CatalogLayerBuilder implements ContextLayerBuilder {
    readonly stage = 'catalog' as Extract<
        ContextLayerKind,
        'core' | 'catalog' | 'active'
    >;

    private readonly estimator: TokenEstimator;
    private readonly defaultResidence: LayerResidence;
    private readonly defaultPriority: number;
    private readonly fallbackEntryLimit: number;

    constructor(private readonly config: CatalogLayerBuilderConfig = {}) {
        this.estimator = ensureEstimator(config.tokenEstimator);
        this.defaultResidence = config.defaultResidence ?? 'resident';
        this.defaultPriority = config.defaultPriority ?? 80;
        this.fallbackEntryLimit = config.fallbackEntryLimit ?? 5;
    }

    async build(
        input: LayerInputContext,
        options?: LayerBuildOptions,
    ): Promise<LayerBuildResult> {
        const material =
            (await this.config.materializer?.build(input)) ??
            fallbackCatalogEntries(
                input.retrieval,
                this.fallbackEntryLimit,
                this.estimator,
            );

        const entries: LayerEntry<CatalogEntry | string>[] = [];

        for (const entry of material.entries ?? []) {
            entries.push({
                category: 'catalog-entry',
                data: entry,
                tokens: this.estimator.estimateText(entry.summary),
                critical: entry.importance === 'high',
            });
        }

        for (const insight of material.insights ?? []) {
            entries.push({
                category: 'insight',
                data: insight,
                tokens: this.estimator.estimateText(insight),
            });
        }

        const limit = options?.maxTokens;
        const { kept, dropped, total } = allocateEntries(entries, limit);
        const entriesKept = kept
            .filter((entry) => entry.category === 'catalog-entry')
            .map((entry) => entry.data as CatalogEntry);
        const insightsKept = kept
            .filter((entry) => entry.category === 'insight')
            .map((entry) => entry.data as string);

        const diagnostics: LayerBuildDiagnostics = {
            tokensBefore: entries.reduce((acc, entry) => acc + entry.tokens, 0),
            tokensAfter: total,
            compactionStrategy: dropped.length ? 'truncate-by-limit' : undefined,
            notes: summarizeDropped(dropped),
        };

        const content = {
            entries: entriesKept.map(
                ({ id, title, summary, importance, entities, metadata }) => ({
                    id,
                    title,
                    summary,
                    importance,
                    entities,
                    metadata,
                }),
            ),
            insights: insightsKept,
            runtimeState: {
                ...(material.runtimeState ?? {}),
                candidateCount: input.retrieval?.candidates.length ?? 0,
            },
        };

        const references = [
            ...(material.references ?? []),
            ...entriesKept.flatMap((entry) => entry.references ?? []),
        ];

        const layer: ContextLayer = {
            kind: this.stage,
            priority: options?.priority ?? this.defaultPriority,
            tokens: total,
            residence: options?.residence ?? this.defaultResidence,
            content,
            references,
            metadata: {
                ...(material.metadata ?? {}),
                builder: 'catalog-layer',
                droppedEntries: dropped.length,
            },
        };

        return {
            layer,
            resources: material.resources ?? [],
            diagnostics,
        };
    }
}
