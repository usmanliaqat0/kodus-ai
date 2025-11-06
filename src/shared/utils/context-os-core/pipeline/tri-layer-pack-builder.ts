import type {
    ContextPack,
    ContextPackBuilder,
    LayerInputContext,
    PackAssemblyPipeline,
} from '../interfaces.js';

import { computeBudget } from '../utils/budget.js';

export interface TriLayerPackBuilderConfig {
    pipeline: PackAssemblyPipeline;
    budgetLimit?: number;
    createdBy?: string;
}

export class TriLayerPackBuilder implements ContextPackBuilder {
    constructor(private readonly config: TriLayerPackBuilderConfig) {}

    async buildPack({
        query,
        candidates,
        existingContext,
    }: Parameters<ContextPackBuilder['buildPack']>[0]): Promise<ContextPack> {
        const input: LayerInputContext = {
            domain: query.domain,
            taskIntent: query.taskIntent,
            retrieval: { candidates, diagnostics: {} },
            runtimeContext: existingContext,
            deliveryRequest: undefined,
            metadata: { query },
        };

        const { pack } = await this.config.pipeline.execute(input, {
            maxTokens: query.constraints?.maxTokens,
        });

        const budgetLimit =
            query.constraints?.maxTokens ?? this.config.budgetLimit ?? 8192;

        return {
            ...pack,
            budget: computeBudget(budgetLimit, pack.layers),
            createdBy: this.config.createdBy ?? pack.createdBy,
        };
    }
}
