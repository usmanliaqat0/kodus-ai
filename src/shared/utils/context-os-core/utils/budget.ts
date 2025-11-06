import type { ContextLayer, TokenBudget } from '../interfaces.js';

export function computeBudget(
    limit: number,
    layers: ContextLayer[],
): TokenBudget {
    return {
        limit,
        usage: layers.reduce((acc, layer) => acc + layer.tokens, 0),
        breakdown: layers.reduce<Record<string, number>>((acc, layer) => {
            acc[layer.kind] = layer.tokens;
            return acc;
        }, {}),
    };
}
