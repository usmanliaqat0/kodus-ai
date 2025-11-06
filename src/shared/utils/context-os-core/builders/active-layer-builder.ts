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

export interface ActiveSnippetMetadata extends Record<string, unknown> {
    critical?: boolean;
}

export interface ActiveSnippet {
    id: string;
    itemId: string;
    text: string;
    score?: number;
    reason?: string;
    references?: Array<{ itemId: string; sliceId?: string }>;
    resources?: ContextResourceRef[];
    metadata?: ActiveSnippetMetadata;
}

export interface ActiveLayerMaterial {
    snippets: ActiveSnippet[];
    references?: Array<{ itemId: string; sliceId?: string }>;
    resources?: ContextResourceRef[];
    metadata?: Record<string, unknown>;
}

export interface ActiveLayerSelector {
    select(input: LayerInputContext): Promise<ActiveLayerMaterial>;
}

export interface ActiveLayerBuilderConfig {
    selector?: ActiveLayerSelector;
    tokenEstimator?: TokenEstimator;
    defaultResidence?: LayerResidence;
    defaultPriority?: number;
    maxSnippets?: number;
}

function stringifyStructured(input: unknown, estimator: TokenEstimator): string {
    if (input == null) {
        return '';
    }

    if (typeof input === 'string') {
        return input;
    }

    try {
        const asString = JSON.stringify(input);
        if (estimator.estimateText(asString) > 768) {
            return `${asString.slice(0, 3072)}... (truncated)`;
        }

        return asString;
    } catch {
        return '';
    }
}

function fallbackActiveMaterial(
    input: LayerInputContext,
    estimator: TokenEstimator,
    maxSnippets: number,
): ActiveLayerMaterial {
    const candidates = input.retrieval?.candidates ?? [];
    const snippets: ActiveSnippet[] = [];

    for (const candidate of candidates) {
        if (snippets.length >= maxSnippets) {
            break;
        }

        const primarySlice = candidate.slices?.[0];
        const snippetText =
            primarySlice?.summary ??
            candidate.item.payload.text ??
            stringifyStructured(candidate.item.payload.structured, estimator);

        const truncated =
            estimator.estimateText(snippetText) > 768
                ? `${snippetText.slice(0, 3072)}... (truncated)`
                : snippetText;

        const attachments = Array.isArray(candidate.item.payload.attachments)
            ? candidate.item.payload.attachments
            : [];

        const resources = attachments.map(
            (attachment, index): ContextResourceRef => ({
                id: `${candidate.item.id}-attachment-${index}`,
                type: 'attachment',
                location: String(attachment),
                description: `Attachment from ${candidate.item.id}`,
                metadata: { candidateScore: candidate.score },
            }),
        );

        const sliceMetadata = primarySlice?.metadata as
            | Record<string, unknown>
            | undefined;
        const reasonFromSlice =
            sliceMetadata && typeof sliceMetadata.reason === 'string'
                ? (sliceMetadata.reason as string)
                : undefined;
        const candidateRationale =
            typeof candidate.rationale === 'string'
                ? candidate.rationale
                : undefined;

        snippets.push({
            id: `${candidate.item.id}-snippet`,
            itemId: candidate.item.id,
            text: truncated,
            score: candidate.score,
            reason: reasonFromSlice ?? candidateRationale,
            references: [{ itemId: candidate.item.id }],
            resources,
            metadata: {
                selector: 'fallback',
                sourceLocation: candidate.item.source.location,
            },
        });
    }

    return {
        snippets,
        references: snippets.flatMap((snippet) => snippet.references ?? []),
        resources: snippets.flatMap((snippet) => snippet.resources ?? []),
        metadata: { fallback: true },
    };
}

export class ActiveLayerBuilder implements ContextLayerBuilder {
    readonly stage = 'active' as Extract<
        ContextLayerKind,
        'core' | 'catalog' | 'active'
    >;

    private readonly estimator: TokenEstimator;
    private readonly defaultResidence: LayerResidence;
    private readonly defaultPriority: number;
    private readonly maxSnippets: number;

    constructor(private readonly config: ActiveLayerBuilderConfig = {}) {
        this.estimator = ensureEstimator(config.tokenEstimator);
        this.defaultResidence = config.defaultResidence ?? 'on_demand';
        this.defaultPriority = config.defaultPriority ?? 60;
        this.maxSnippets = config.maxSnippets ?? 10;
    }

    async build(
        input: LayerInputContext,
        options?: LayerBuildOptions,
    ): Promise<LayerBuildResult> {
        const material =
            (await this.config.selector?.select(input)) ??
            fallbackActiveMaterial(input, this.estimator, this.maxSnippets);

        const entries: LayerEntry<ActiveSnippet>[] = [];
        for (const snippet of material.snippets ?? []) {
            entries.push({
                category: 'snippet',
                data: snippet,
                tokens: this.estimator.estimateText(snippet.text),
                critical: snippet.metadata?.critical === true,
            });
        }

        const limit = options?.maxTokens;
        const { kept, dropped, total } = allocateEntries(entries, limit);
        const snippetsKept = kept.map((entry) => entry.data);

        const diagnostics: LayerBuildDiagnostics = {
            tokensBefore: entries.reduce((acc, entry) => acc + entry.tokens, 0),
            tokensAfter: total,
            compactionStrategy: dropped.length ? 'truncate-by-limit' : undefined,
            notes: summarizeDropped(dropped),
        };

        const onDemandResources = [
            ...(material.resources ?? []),
            ...snippetsKept.flatMap((snippet) => snippet.resources ?? []),
        ];

        const references = [
            ...(material.references ?? []),
            ...snippetsKept.flatMap((snippet) => snippet.references ?? []),
        ];

        const content = {
            snippets: snippetsKept.map(
                ({ id, itemId, text, score, reason, metadata }) => ({
                    id,
                    itemId,
                    text,
                    score,
                    reason,
                    metadata,
                }),
            ),
            retrievalMetadata: {
                candidateCount: input.retrieval?.candidates.length ?? 0,
                latencyMs: input.retrieval?.durationMs,
            },
        };

        const layer: ContextLayer = {
            kind: this.stage,
            priority: options?.priority ?? this.defaultPriority,
            tokens: total,
            residence: options?.residence ?? this.defaultResidence,
            content,
            references,
            metadata: {
                ...(material.metadata ?? {}),
                builder: 'active-layer',
                droppedEntries: dropped.length,
            },
        };

        return {
            layer,
            resources: onDemandResources,
            diagnostics,
        };
    }
}
