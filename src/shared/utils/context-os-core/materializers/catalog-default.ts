import type { LayerInputContext } from '../interfaces.js';

import type {
    CatalogLayerMaterial,
    CatalogLayerMaterializer,
} from '../builders/catalog-layer-builder.js';

interface CatalogDefaultConfig {
    fallbackEntryLimit?: number;
    highlightThreshold?: number;
}

export class DefaultCatalogMaterializer implements CatalogLayerMaterializer {
    private readonly fallbackEntryLimit: number;
    private readonly highlightThreshold: number;

    constructor(config: CatalogDefaultConfig = {}) {
        this.fallbackEntryLimit = config.fallbackEntryLimit ?? 5;
        this.highlightThreshold = config.highlightThreshold ?? 0.75;
    }

    async build(input: LayerInputContext): Promise<CatalogLayerMaterial> {
        const candidates = input.retrieval?.candidates ?? [];
        const limited = candidates.slice(0, this.fallbackEntryLimit);

        const entries = limited.map((candidate, index) => {
            const title =
                candidate.item.metadata.title ??
                candidate.item.source.location ??
                candidate.item.id;

            const importance: 'high' | 'medium' | 'low' =
                candidate.score >= this.highlightThreshold ? 'high' : 'medium';

            const summary =
                candidate.slices?.map((slice) => slice.summary).join('\n') ??
                candidate.item.payload.text ??
                JSON.stringify(candidate.item.payload.structured ?? candidate.item);

            const entities =
                candidate.item.metadata.tags?.map((tag) => ({
                    id: `${candidate.item.id}-${tag}`,
                    type: 'tag',
                    name: tag,
                })) ?? [];

            return {
                id: `${candidate.item.id}-catalog-${index}`,
                title,
                summary,
                importance,
                references: [{ itemId: candidate.item.id }],
                entities,
                metadata: {
                    score: candidate.score,
                    rationale: candidate.rationale,
                },
            };
        });

        const insights = limited
            .map((item) => item.metadata?.reason as string | undefined)
            .filter((value): value is string => Boolean(value));

        return {
            entries,
            insights,
            runtimeState: {
                candidateCount: candidates.length,
                generatedAt: Date.now(),
            },
            references: limited.map((candidate) => ({ itemId: candidate.item.id })),
            metadata: {
                generator: 'default-catalog-materializer',
            },
        };
    }
}
