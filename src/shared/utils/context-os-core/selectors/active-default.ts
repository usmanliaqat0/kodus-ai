import type {
    Candidate,
    ContextResourceRef,
    LayerInputContext,
} from '../interfaces.js';

import type {
    ActiveLayerMaterial,
    ActiveLayerSelector,
    ActiveSnippet,
} from '../builders/active-layer-builder.js';

interface SelectorConfig {
    maxSnippets?: number;
    includeAttachments?: boolean;
}

const DEFAULT_MAX_SNIPPETS = 8;

export class DefaultActiveSelector implements ActiveLayerSelector {
    private readonly maxSnippets: number;
    private readonly includeAttachments: boolean;

    constructor(private readonly config: SelectorConfig = {}) {
        this.maxSnippets =
            config.maxSnippets && config.maxSnippets > 0
                ? config.maxSnippets
                : DEFAULT_MAX_SNIPPETS;
        this.includeAttachments = config.includeAttachments ?? true;
    }

    async select(input: LayerInputContext): Promise<ActiveLayerMaterial> {
        const candidates = input.retrieval?.candidates ?? [];
        const snippets: ActiveSnippet[] = [];
        const resources: ContextResourceRef[] = [];

        for (const candidate of candidates) {
            if (snippets.length >= this.maxSnippets) {
                break;
            }

            const { snippet, snippetResources } = this.buildSnippet(candidate);
            snippets.push(snippet);
            resources.push(...snippetResources);
        }

        return {
            snippets,
            references: snippets.flatMap((item) => item.references ?? []),
            resources,
            metadata: {
                selector: 'default-active-selector',
                candidateCount: candidates.length,
            },
        };
    }

    private buildSnippet(candidate: Candidate): {
        snippet: ActiveSnippet;
        snippetResources: ContextResourceRef[];
    } {
        const primarySlice = candidate.slices?.[0];
        const snippetText =
            primarySlice?.summary ??
            candidate.item.payload.text ??
            JSON.stringify(candidate.item.payload.structured ?? candidate.item);

        const resources =
            this.includeAttachments && Array.isArray(candidate.item.payload.attachments)
                ? candidate.item.payload.attachments.map(
                      (attachment, index): ContextResourceRef => ({
                          id: `${candidate.item.id}-attachment-${index}`,
                          type: 'attachment',
                          location: String(attachment),
                          description: `Attachment from ${candidate.item.id}`,
                          metadata: { candidateScore: candidate.score },
                      }),
                  )
                : [];

        return {
            snippet: {
                id: `${candidate.item.id}-snippet`,
                itemId: candidate.item.id,
                text: snippetText,
                score: candidate.score,
                reason:
                    typeof primarySlice?.metadata?.reason === 'string'
                        ? (primarySlice?.metadata?.reason as string)
                        : candidate.rationale,
                references: [{ itemId: candidate.item.id }],
                resources,
                metadata: {
                    selector: 'default-active-selector',
                    sourceLocation: candidate.item.source.location,
                },
            },
            snippetResources: resources,
        };
    }
}
