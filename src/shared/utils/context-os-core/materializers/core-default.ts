import type {
    AgentIdentity,
    LayerInputContext,
    ToolDescriptor,
} from '../interfaces.js';

import type {
    CoreLayerConstraint,
    CoreLayerInstruction,
    CoreLayerMaterial,
    CoreLayerMaterializer,
} from '../builders/core-layer-builder.js';

export interface DefaultCoreMaterializerConfig {
    persona?: AgentIdentity;
    baseInstructions?: CoreLayerInstruction[];
    baseConstraints?: CoreLayerConstraint[];
    defaultNotes?: string[];
    defaultToolset?: ToolDescriptor[];
    defaultChecklists?: string[];
}

export class DefaultCoreMaterializer implements CoreLayerMaterializer {
    constructor(private readonly config: DefaultCoreMaterializerConfig = {}) {}

    async materialize(input: LayerInputContext): Promise<CoreLayerMaterial> {
        const instructions: CoreLayerInstruction[] = [
            ...(this.config.baseInstructions ?? []),
            {
                id: 'task-intent',
                text: `Objetivo da tarefa: ${input.taskIntent}`,
                critical: true,
                metadata: { source: 'runtime' },
            },
        ];

        const constraints: CoreLayerConstraint[] = [
            ...(this.config.baseConstraints ?? []),
        ];

        const notes = new Set<string>(this.config.defaultNotes ?? []);

        if (input.runtimeContext?.state?.lastUserIntent) {
            notes.add(
                `Última intenção registrada: ${input.runtimeContext.state.lastUserIntent}`,
            );
        }

        if (input.deliveryRequest?.agentIdentity?.name) {
            notes.add(
                `Agente responsável: ${input.deliveryRequest.agentIdentity.name}`,
            );
        }

        const references =
            input.retrieval?.candidates
                .slice(0, 5)
                .map((candidate) => ({ itemId: candidate.item.id })) ?? [];

        return {
            persona: this.config.persona ?? input.deliveryRequest?.agentIdentity,
            instructions,
            constraints,
            checklists:
                this.config.defaultChecklists ??
                this.config.defaultNotes ??
                [],
            notes: Array.from(notes),
            toolset:
                this.config.defaultToolset ??
                input.deliveryRequest?.toolset ??
                [],
            references,
            metadata: {
                generator: 'default-core-materializer',
                domain: input.domain,
                runtimeState: input.runtimeContext?.state,
            },
        };
    }
}
