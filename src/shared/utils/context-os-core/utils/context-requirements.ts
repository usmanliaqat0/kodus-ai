import { createHash } from 'crypto';

import type {
    ContextRequirement,
    ContextRevisionActor,
    ContextRevisionLogEntry,
    ContextRevisionScope,
} from '../interfaces.js';

export interface MergeRequirementsOptions {
    /**
     * Quando true, requisitos declarados posteriormente (mais específicos)
     * sobrescrevem os anteriores. Por padrão, o último valor vence.
     */
    preferLatest?: boolean;
    /**
     * Se verdadeiro, requisitos marcados com status 'deprecated' ou metadata.disabled
     * removem entradas herdadas com o mesmo id.
     */
    allowDisable?: boolean;
}

export interface MergeRequirementsResult {
    requirements: ContextRequirement[];
    disabledIds: string[];
}

export function mergeContextRequirements(
    sources: ContextRequirement[][],
    options: MergeRequirementsOptions = {},
): MergeRequirementsResult {
    const preferLatest = options.preferLatest ?? true;
    const allowDisable = options.allowDisable ?? true;
    const byId = new Map<string, ContextRequirement>();
    const disabled = new Set<string>();

    for (const list of sources) {
        for (const requirement of list ?? []) {
            if (allowDisable && requirement.metadata?.disabled === true) {
                byId.delete(requirement.id);
                disabled.add(requirement.id);
                continue;
            }
            if (
                allowDisable &&
                requirement.status === 'deprecated' &&
                byId.has(requirement.id)
            ) {
                byId.delete(requirement.id);
                disabled.add(requirement.id);
                continue;
            }

            if (!byId.has(requirement.id) || preferLatest) {
                byId.set(requirement.id, requirement);
            }
        }
    }

    return {
        requirements: Array.from(byId.values()),
        disabledIds: Array.from(disabled.values()),
    };
}

export function computeRequirementsHash(
    requirements: ContextRequirement[],
): string {
    const sorted = [...requirements].sort((a, b) => a.id.localeCompare(b.id));
    const payload = JSON.stringify(sorted);
    return createHash('sha256').update(payload).digest('hex');
}

export interface CreateRevisionParams {
    revisionId: string;
    parentRevisionId?: string;
    scope: ContextRevisionScope;
    entityType: string;
    entityId: string;
    origin?: ContextRevisionActor;
    requirements?: ContextRequirement[];
    payload?: Record<string, unknown>;
    knowledgeRefs?: ContextRevisionLogEntry['knowledgeRefs'];
    metadata?: Record<string, unknown>;
}

export function createRevisionEntry(
    params: CreateRevisionParams,
): ContextRevisionLogEntry {
    const payload: Record<string, unknown> =
        params.payload ??
        (params.requirements ? { requirements: params.requirements } : {});

    const timestamp = Date.now();

    return {
        revisionId: params.revisionId,
        parentRevisionId: params.parentRevisionId,
        scope: params.scope,
        entityType: params.entityType,
        entityId: params.entityId,
        payload,
        requirements: params.requirements,
        origin: params.origin,
        createdAt: timestamp,
        knowledgeRefs: params.knowledgeRefs,
        metadata: params.metadata,
    };
}
