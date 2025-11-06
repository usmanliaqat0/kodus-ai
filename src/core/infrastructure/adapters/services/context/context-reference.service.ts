import { v4 as uuidv4 } from 'uuid';

import { Inject, Injectable } from '@nestjs/common';
import {
    CONTEXT_REFERENCE_REPOSITORY_TOKEN,
    IContextReferenceRepository,
} from '@/core/domain/contextReferences/contracts/context-reference.repository.contract';
import { IContextReferenceService } from '@/core/domain/contextReferences/contracts/context-reference.service.contract';
import { ContextReferenceEntity } from '@/core/domain/contextReferences/entities/context-reference.entity';
import { IContextReference } from '@/core/domain/contextReferences/interfaces/context-reference.interface';
import {
    ContextRevisionScope,
    ContextRequirement,
    ContextRevisionActor,
} from '@context-os-core/interfaces';
import {
    createRevisionEntry,
    computeRequirementsHash,
} from '@context-os-core/utils/context-requirements';

@Injectable()
export class ContextReferenceService implements IContextReferenceService {
    constructor(
        @Inject(CONTEXT_REFERENCE_REPOSITORY_TOKEN)
        private readonly repository: IContextReferenceRepository,
    ) {}

    async commitRevision(params: {
        scope: ContextRevisionScope;
        entityType: string;
        entityId: string;
        requirements?: ContextRequirement[];
        parentReferenceId?: string;
        uuid?: string;
        origin?: ContextRevisionActor;
        metadata?: Record<string, unknown>;
        knowledgeRefs?: Array<{ itemId: string; version?: string }>;
        revisionId?: string;
    }): Promise<{
        revision: ContextReferenceEntity;
        pointer: { uuid: string; requirementsHash?: string };
    }> {
        const uuid = params.uuid ?? uuidv4();
        const origin: ContextRevisionActor = params.origin ?? {
            kind: 'system',
            id: 'unknown',
        };

        // 🔒 INVARIANTE 1: Garantir tenantId no scope (usa organizationId como fallback)
        const scopeWithTenant = this.ensureTenantInScope(params.scope);

        // 🔒 INVARIANTE 2: Manter TODOS os requirements (incluindo draft/erro)
        // para trilha completa de debugging, mas marcar quais são executáveis
        const allRequirements = params.requirements ?? [];

        const entry = createRevisionEntry({
            revisionId: uuid,
            parentRevisionId: params.parentReferenceId,
            scope: scopeWithTenant,
            entityType: params.entityType,
            entityId: params.entityId,
            origin,
            requirements: allRequirements, // Manter todos para trilha completa
            metadata: params.metadata,
            knowledgeRefs: params.knowledgeRefs,
        });

        // 🔒 INVARIANTE 3: Incluir ponte para revisão de origem
        const metadataWithRevision = {
            ...entry.metadata,
            ...(params.revisionId && { revisionId: params.revisionId }),
        };

        // Calcular status de processamento baseado nas requirements
        const processingStatus = this.computeProcessingStatus(
            entry.requirements,
        );

        const contextReference: IContextReference = {
            uuid: entry.revisionId,
            parentReferenceId: entry.parentRevisionId,
            scope: entry.scope,
            entityType: entry.entityType,
            entityId: entry.entityId,
            requirements: entry.requirements,
            knowledgeRefs: entry.knowledgeRefs,
            origin: entry.origin,
            revisionId: params.revisionId, // Ponte explícita para fonte da verdade
            processingStatus,
            lastProcessedAt: new Date(),
            metadata: metadataWithRevision,
        };

        const persisted = await this.repository.create(contextReference);
        if (!persisted) {
            throw new Error('Failed to persist context reference');
        }

        const requirementsHash =
            entry.requirements && entry.requirements.length
                ? computeRequirementsHash(entry.requirements)
                : undefined;

        return {
            revision: persisted,
            pointer: { uuid: persisted.uuid, requirementsHash },
        };
    }

    async getRevisionHistory(
        entityType: string,
        entityId: string,
        limit?: number,
    ): Promise<ContextReferenceEntity[]> {
        const results = await this.repository.find({ entityType, entityId });
        if (typeof limit === 'number' && limit >= 0) {
            return results.slice(0, limit);
        }
        return results;
    }

    async getLatestRevision(
        entityType: string,
        entityId: string,
    ): Promise<ContextReferenceEntity | undefined> {
        const [latest] = await this.getRevisionHistory(entityType, entityId, 1);
        return latest;
    }

    async rollbackTo(params: {
        targetReferenceId: string;
        origin?: ContextRevisionActor;
    }): Promise<{
        revision: ContextReferenceEntity;
        pointer: { uuid: string; requirementsHash?: string };
    }> {
        const target = await this.repository.findById(params.targetReferenceId);

        if (!target) {
            throw new Error(
                `Context reference ${params.targetReferenceId} not found`,
            );
        }

        const latest = await this.getLatestRevision(
            target.entityType,
            target.entityId,
        );

        return this.commitRevision({
            scope: target.scope,
            entityType: target.entityType,
            entityId: target.entityId,
            requirements: target.requirements,
            parentReferenceId: latest?.uuid,
            origin:
                params.origin ??
                target.origin ??
                ({ kind: 'system', id: 'rollback' } as ContextRevisionActor),
            metadata: target.metadata,
            knowledgeRefs: target.knowledgeRefs,
        });
    }

    async create(
        contextReference: IContextReference,
    ): Promise<ContextReferenceEntity | undefined> {
        return this.repository.create(contextReference);
    }

    async find(
        filter?: Partial<IContextReference>,
    ): Promise<ContextReferenceEntity[]> {
        return this.repository.find(filter);
    }

    async findOne(
        filter: Partial<IContextReference>,
    ): Promise<ContextReferenceEntity | undefined> {
        return this.repository.findOne(filter);
    }

    async findById(uuid: string): Promise<ContextReferenceEntity | undefined> {
        return this.repository.findById(uuid);
    }

    async update(
        filter: Partial<IContextReference>,
        data: Partial<IContextReference>,
    ): Promise<ContextReferenceEntity | undefined> {
        return this.repository.update(filter, data);
    }

    async delete(uuid: string): Promise<void> {
        return this.repository.delete(uuid);
    }

    /**
     * 🔒 INVARIANTE 1: Garante tenantId no scope
     * Usa organizationId como fallback para compatibilidade com dados existentes
     */
    private ensureTenantInScope(
        scope: ContextRevisionScope,
    ): ContextRevisionScope {
        const identifiers = { ...scope.identifiers };

        // Se já tem tenantId, mantém
        if (identifiers.tenantId) {
            return { ...scope, identifiers };
        }

        // Fallback: usa organizationId como tenant lógico
        if (identifiers.organizationId) {
            identifiers.tenantId = identifiers.organizationId;
        } else {
            // Se não tem nenhum, gera um erro mas não quebra
            console.warn(
                'ContextRevisionScope sem tenantId ou organizationId:',
                scope,
            );
        }

        return { ...scope, identifiers };
    }

    /**
     * Calcula o status de processamento baseado nas requirements
     */
    private computeProcessingStatus(
        requirements?: ContextRequirement[],
    ): 'pending' | 'processing' | 'completed' | 'failed' {
        if (!requirements || requirements.length === 0) {
            return 'pending';
        }

        const hasErrors = requirements.some(
            (req) => (req.metadata as any)?.syncErrors?.length > 0,
        );
        const hasDraft = requirements.some((req) => req.status === 'draft');
        const allActive = requirements.every((req) => req.status === 'active');

        if (hasErrors) {
            return 'failed';
        }

        if (hasDraft) {
            return 'processing';
        }

        if (allActive) {
            return 'completed';
        }

        return 'pending';
    }
}
