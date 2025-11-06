export type EntryCategory =
    | 'instruction'
    | 'constraint'
    | 'note'
    | 'catalog-entry'
    | 'insight'
    | 'snippet';

export interface LayerEntry<T> {
    category: EntryCategory;
    data: T;
    tokens: number;
    critical?: boolean;
}

export interface TokenEstimator {
    estimateText(input: string): number;
    estimateStructured(input: unknown): number;
}

export class HeuristicTokenEstimator implements TokenEstimator {
    // Aproximação rápida: ~4 caracteres por token, com piso de 1.
    estimateText(input: string): number {
        if (!input) {
            return 0;
        }

        const sanitized = input.replace(/\s+/g, ' ').trim();
        if (!sanitized) {
            return 0;
        }

        return Math.max(1, Math.ceil(sanitized.length / 4));
    }

    estimateStructured(input: unknown): number {
        if (input == null) {
            return 0;
        }

        try {
            if (typeof input === 'string') {
                return this.estimateText(input);
            }

            return this.estimateText(JSON.stringify(input));
        } catch {
            return 32; // fallback para estruturas não serializáveis.
        }
    }
}

export function ensureEstimator(estimator?: TokenEstimator): TokenEstimator {
    return estimator ?? new HeuristicTokenEstimator();
}

export function allocateEntries<T>(
    entries: LayerEntry<T>[],
    limit?: number,
): {
    kept: LayerEntry<T>[];
    dropped: LayerEntry<T>[];
    total: number;
} {
    if (limit == null || limit <= 0) {
        const total = entries.reduce((acc, entry) => acc + entry.tokens, 0);
        return { kept: entries, dropped: [], total };
    }

    const kept: LayerEntry<T>[] = [];
    const dropped: LayerEntry<T>[] = [];
    let total = 0;

    for (const entry of entries) {
        const willExceed = total + entry.tokens > limit;
        if (!willExceed || entry.critical) {
            kept.push(entry);
            total += entry.tokens;
        } else {
            dropped.push(entry);
        }
    }

    return { kept, dropped, total };
}

export function summarizeDropped(entries: LayerEntry<unknown>[]): string | undefined {
    if (!entries.length) {
        return undefined;
    }

    const byCategory = entries.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.category] = (acc[entry.category] ?? 0) + 1;
        return acc;
    }, {});

    return Object.entries(byCategory)
        .map(([category, count]) => `${count} ${category}`)
        .join(', ');
}
