import type {
    ContextRequirement,
    ContextRevisionActor,
    ContextRevisionScope,
} from '@context-os-core/interfaces';

/**
 * IContextReference - ATALHO INDEXADO PARA LOOKUP RÁPIDO NO RUNTIME
 *
 * Representa um índice leve e otimizado para lookup rápido de requirements em runtime.
 * É derivado dos ContextRevisionLogEntry (fonte da verdade) mas otimizado para performance.
 *
 * SEMÂNTICA: Este é o "atalho" / cache para acesso rápido. Não duplica dados,
 * apenas indexa o que existe em ContextRevisionLogEntry. É a tabela de lookup
 * que permite encontrar rapidamente requirements por scope/entity.
 *
 * INVARIANTES CRÍTICAS:
 * - scope.identifiers DEVE conter tenantId (ou organizationId como proxy)
 * - revisionId DEVE apontar para o ContextRevisionLogEntry de origem
 * - requirements DEVE conter TODOS os itens (ativos, draft, erro) para trilha completa
 * - Runtime filtra status 'active' para execução, mas preserva histórico completo
 * - No máximo 1 referência ativa por (tenantId, entityType, entityId, scope.level/path)
 */
export interface IContextReference {
    uuid: string;
    parentReferenceId?: string;
    scope: ContextRevisionScope;
    entityType: string;
    entityId: string;
    requirements?: ContextRequirement[];
    knowledgeRefs?: Array<{ itemId: string; version?: string }>;
    /** Ponte explícita para a revisão de origem (fonte da verdade) */
    revisionId?: string;
    origin?: ContextRevisionActor;
    /** Status de processamento derivado das requirements (calculado em runtime) */
    processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
    /** Timestamp do último processamento das references */
    lastProcessedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
    metadata?: Record<string, unknown>;
}
