/**
 * Context Engineering Interfaces
 *
 * Este módulo define contratos agnósticos para ingestão, seleção,
 * compactação e entrega de contexto para LLMs. Ele pode ser usado como
 * base para implementar um “context OS” independente de domínio.
 */

/**
 * Domínio lógico ao qual um item de conhecimento ou requisito pertence.
 * Pode ser qualquer string definida pela aplicação (ex.: 'code', 'support').
 */
export type ContextDomain = string;

/** Classificação de sensibilidade/PII associada a um item. */
export type SensitivityLevel = 'none' | 'low' | 'medium' | 'high';
/** Classificação de confidencialidade usada para filtragem/controle de acesso. */
export type ConfidentialityLevel = 'public' | 'internal' | 'restricted';

/** Generic path type that includes predefined paths or custom string arrays. */
export type ContextPath = string[];

/**
 * Convenções recomendadas para ContextPath (não obrigatórias):
 *
 * Para aplicações de análise de código:
 * - ['kodyRule', ruleUuid] - regras específicas do Kody
 * - ['category', 'bug'|'performance'|'security'] - categorias de problemas
 * - ['severity', 'critical'|'high'|'medium'|'low'] - níveis de severidade
 * - ['customInstructions', 'main'] - instruções personalizadas
 * - ['generation', 'main'] - geração de conteúdo
 *
 * Para aplicações de suporte:
 * - ['ticket', 'bug'|'feature'|'question'] - tipos de ticket
 * - ['priority', 'urgent'|'high'|'normal'|'low'] - prioridades
 * - ['channel', 'email'|'chat'|'phone'] - canais de contato
 *
 * Aplicações são livres para definir suas próprias convenções.
 */

/** Referência de origem de um item (arquivo, API, MCP, etc.). */
export interface SourceRef {
    type: string;
    location: string;
    accessor?: string;
    metadata?: Record<string, unknown>;
}

/** Ações de lineage que podem ocorrer durante o ciclo de vida de um item. */
export type LineageAction =
    | 'created'
    | 'updated'
    | 'compacted'
    | 'expired'
    | 'approved'
    | 'rollback';

/**
 * ActorRef - REFERÊNCIA BASE PARA QUALQUER TIPO DE ATOR NO SISTEMA
 *
 * Representação unificada de qualquer entidade que pode realizar ações no sistema.
 * Serve como base para todos os tipos de ator (humanos, sistemas, agentes, etc).
 */
export interface ActorRef {
    /** Tipo de ator (human, system, agent, service, etc). */
    kind: string;
    /** Identificador único opcional do ator. */
    id?: string;
    /** Nome legível do ator. */
    name?: string;
    /** Metadados específicos do tipo de ator. */
    metadata?: Record<string, unknown>;
}

/** Atores que podem realizar ações de lineage. */
export type LineageActor = 'ingestion' | 'human' | 'automation';

/** Registro de lineage para rastrear origem/evolução de um item. */
export interface LineageRecord {
    timestamp: number;
    actor: LineageActor;
    action: LineageAction;
    notes?: string;
    metadata?: Record<string, unknown>;
}

/** Estrutura base de um item de conhecimento persistido pelo Context-OS. */
/** Item de conhecimento normalizado e persistido pelo Context-OS. */
export interface KnowledgeItem {
    id: string;
    domain: ContextDomain;
    source: SourceRef;
    payload: {
        text?: string;
        structured?: unknown;
        attachments?: string[];
    };
    modality?: 'text' | 'code' | 'table' | 'image' | 'event' | string;
    metadata: {
        version: string;
        title?: string;
        tags?: string[];
        piiLevel?: SensitivityLevel;
        confidentiality: ConfidentialityLevel;
        ttlMs?: number;
        createdAt: number;
        updatedAt: number;
        lineage: LineageRecord[];
        tenantId: string; // chave de isolamento multi-tenant obrigatória
        ownerId?: string;
        checksum?: string;
    };
}

/** Capacidades suportadas por um conector de ingestão. */
export type ConnectorCapability =
    | 'poll'
    | 'webhook'
    | 'search'
    | 'snapshot'
    | 'metadata';

/** Alteração capturada por um conector de conhecimento bruto. */
export interface RawChange<TMeta = unknown> {
    ref: SourceRef;
    changeType: 'added' | 'modified' | 'removed';
    metadata?: TMeta;
    cursor?: string | number;
}

/** Asset bruto retornado por um conector (arquivo, payload JSON, etc.). */
export interface RawAsset {
    ref: SourceRef;
    content: ArrayBuffer | string | Record<string, unknown>;
    contentType?: string;
    metadata?: Record<string, unknown>;
}

/** Interface genérica para conectores de ingestão. */
export interface Connector<TMeta = unknown> {
    id: string;
    capabilities: ConnectorCapability[];
    schema?: unknown;
    listChanges(
        params: Record<string, unknown>,
    ): AsyncIterable<RawChange<TMeta>>;
    fetchItem(ref: SourceRef): Promise<RawAsset>;
    close?(): Promise<void>;
}

/** Problema encontrado durante validação de itens. */
export interface ValidationIssue {
    level: 'info' | 'warning' | 'error';
    message: string;
    itemId?: string;
}

/** Resultado de validação de uma coleção de itens. */
export interface ValidationReport {
    issues: ValidationIssue[];
    isValid: boolean;
}

/** Pipeline de ingestão (normalização → validação → persistência). */
export interface IngestionPipeline {
    normalize(change: RawChange): Promise<KnowledgeItem[]>;
    validate(items: KnowledgeItem[]): Promise<ValidationReport>;
    persist(items: KnowledgeItem[]): Promise<void>;
}

/** Pacote de sinais (mensagem do usuário, contexto da conversa, etc.). */
export interface SignalPacket {
    userMessage?: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Consulta de recuperação (quem precisa de contexto, com quais constraints).
 */
export interface RetrievalQuery {
    domain: ContextDomain;
    taskIntent: string;
    signal: SignalPacket;
    constraints?: {
        maxTokens?: number;
        since?: number;
        includeDomains?: ContextDomain[];
        excludeSources?: string[];
        confidentiality?: ConfidentialityLevel;
    };
    hints?: Record<string, unknown>;
}

export interface ContentSlice {
    range?: [number, number];
    summary?: string;
    weight: number;
    metadata?: Record<string, unknown>;
}

/** Candidato retornado por um selector/indexer ao montar contexto. */
export interface Candidate {
    item: KnowledgeItem;
    score: number;
    /** rationale DEVE SER OBRIGATÓRIO PARA EXPLICABILIDADE
     *
     * Justificativa de por que este candidato foi selecionado e como ele contribui
     * para o contexto. Essencial para auditoria, debugging e melhoria de qualidade.
     * Seguindo as melhores práticas de Anthropic/Weaviate para context engineering explicável.
     */
    rationale?: string;
    slices?: ContentSlice[];
    metadata?: Record<string, unknown>;
}

/** Resultado completo de uma consulta de recuperação. */
export interface RetrievalResult {
    candidates: Candidate[];
    durationMs?: number;
    diagnostics?: Record<string, unknown>;
}

/** Interface para indexadores (vector, lexical, híbrido...). */
export interface Indexer {
    upsert(items: KnowledgeItem[]): Promise<void>;
    delete(itemIds: string[]): Promise<void>;
    query(request: RetrievalQuery): Promise<RetrievalResult>;
}

/** Indica onde a camada deve residir (sempre presente, on-demand, cache). */
export type LayerResidence = 'resident' | 'on_demand' | 'cached';

/** Enum simbólico dos principais tipos de camada aceitos pelo pack. */
export type ContextLayerKind =
    | 'core'
    | 'catalog'
    | 'active'
    | 'instructions'
    | 'facts'
    | 'history'
    | 'entities'
    | 'tools'
    | 'metadata'
    | string;

/** Informações de orçamento de tokens para um pack/contexto. */
export interface TokenBudget {
    limit: number;
    usage: number;
    breakdown: Record<string, number>;
}

/** Camada de contexto (core, catalog, active...) entregue ao LLM. */
export interface ContextLayer {
    id?: string;
    kind: ContextLayerKind;
    priority: number;
    tokens: number;
    residence?: LayerResidence;
    content: unknown;
    /** references DEVE SER OBRIGATÓRIO PARA AUDITORIA E EXPLICABILIDADE
     *
     * Lista de itens/slides que foram usados para construir esta camada.
     * Essencial para rastrear provenance, debugging e compliance.
     * Cada camada deve declarar explicitamente suas fontes de conhecimento.
     */
    references: Array<{ itemId: string; sliceId?: string }>;
    metadata?: Record<string, unknown>;
}

/** Referência a recursos adicionais que acompanham o pack (scripts, arquivos...). */
export interface ContextResourceRef {
    id: string;
    type: 'file' | 'script' | 'template' | 'binary' | string;
    location: string;
    description?: string;
    metadata?: Record<string, unknown>;
}

/** Tipo de ação que pode ser vinculada a um pack/contexto. */
export type ContextActionType =
    | 'mcp'
    | 'workflow'
    | 'internal'
    | 'http'
    | string;

/** Momento em que a ação deve disparar durante o lifecycle do pack. */
export type ContextActionTrigger =
    | 'pre_core'
    | 'pre_delivery'
    | 'post_delivery'
    | 'async'
    | 'background';

/** Descrição de uma ação obrigatória/opcional associada ao contexto. */
export interface ContextActionDescriptor {
    id: string;
    type: ContextActionType;
    trigger: ContextActionTrigger;
    instruction?: string;
    metadata?: Record<string, unknown>;
    config?: Record<string, unknown>;
    mcpId?: string;
    toolName?: string;
    workflowId?: string;
    callable?: string;
    endpoint?: string;
}

/** Tipos comuns de consumidores de contexto */
export type ContextConsumerKind =
    | 'prompt' // Prompts de LLM (ex.: system prompts, custom instructions)
    | 'workflow' // Workflows automatizados
    | 'action' // Ações/triggers
    | 'tool' // Ferramentas customizadas
    | 'agent' // Agentes inteligentes
    | string; // Extensível para domínios específicos

/**
 * ContextConsumerRef - Referência para quem consome contexto
 *
 * Convenções de uso:
 * - kind: Define o tipo de consumidor ('prompt', 'workflow', 'agent', etc.)
 * - metadata.path: Caminho hierárquico do consumidor (ex.: ['kodyRule', ruleId])
 * - metadata.sourceType: Tipo específico da fonte ('kody_rule', 'custom_prompt', etc.)
 * - id: Identificador único do consumidor no seu domínio
 */
export interface ContextConsumerRef extends ActorRef {
    id: string; // Campo obrigatório para consumidores
    kind: ContextConsumerKind;
}

/**
 * ContextRequirement - CONTRATO IMUTÁVEL / VERSIONADO DE CONSUMO DE CONTEXTO
 *
 * Define quem consome, qual consulta deve ser executada e quais ferramentas/camadas
 * devem estar presentes antes da execução. É a "especificação" do que um consumidor
 * precisa para funcionar corretamente.
 *
 * SEMÂNTICA: Este é o contrato imutável/versionado que define as necessidades
 * de contexto de uma entidade (prompt, workflow, etc). Ele especifica o quê,
 * não como ou quando.
 */
export interface ContextRequirement {
    /** Identificador único do requisito no escopo atual. */
    id: string;
    /** Consumidor do contexto (prompt, workflow, etc.). */
    consumer: ContextConsumerRef;
    /** Consulta de recuperação (domínio, intento, constraints, hints...). */
    request: RetrievalQuery;
    /** (Opcional) Perfil/pipeline de pack a ser usado. */
    packProfileId?: string;
    /** (Opcional) Camadas que devem existir no pack resultante. */
    requiredLayerKinds?: ContextLayerKind[];
    /** Dependências adicionais (tool, workflow, outro prompt, knowledge etc.). */
    dependencies?: ContextDependency[];
    /** Se false, o contexto é obrigatório e não pode falhar. */
    optional?: boolean;
    /** Metadados específicos do domínio. */
    metadata?: Record<string, unknown>;
    /** Versionamento do requisito (semantic version, hash etc.). */
    version?: string;
    /** Última revisão que tocou este requisito. */
    revisionId?: string;
    /** Revisão anterior (ajuda a rastrear diffs locais). */
    parentRevisionId?: string;
    /** Auditoria básica. */
    createdBy?: string;
    createdAt?: number;
    updatedBy?: string;
    updatedAt?: number;
    /** Estado atual do requisito. */
    status?: 'active' | 'deprecated' | 'draft';
}

/**
 * ContextDependency - WHITELIST OFICIAL DE TOOLS/KNOWLEDGE PARA GOVERNANÇA
 *
 * Define dependências externas que precisam estar disponíveis no contexto runtime.
 * Funciona como whitelist formal: um agente/prompt/workflow SÓ PODE usar ferramentas,
 * knowledge ou MCPs que apareçam como ContextDependency ativos no seu pack/context.
 *
 * SEMÂNTICA DE GOVERNANÇA:
 * - 'mcp': Ferramentas MCP registradas (controla superfície de ataque)
 * - 'tool': Ferramentas customizadas do sistema
 * - 'knowledge': Itens de conhecimento específicos
 * - 'workflow': Workflows permitidos para chaining
 * - 'prompt': Prompts que podem ser chamados
 * - 'action': Ações customizadas permitidas
 *
 * QUALQUER tool/knowledge/MCP usado em runtime DEVE estar nesta whitelist.
 */
export interface ContextDependency {
    /** Categoria da dependência (tool, workflow, prompt, knowledge, etc.). */
    type:
        | 'tool'
        | 'mcp'
        | 'workflow'
        | 'prompt'
        | 'action'
        | 'knowledge'
        | string;
    /** Identificador ou slug da dependência. */
    id: string;
    /** Definição/descriptor bruto da dependência (ex.: MCPToolReference). */
    descriptor?: unknown;
    /** Metadados específicos (ex.: parâmetros de execução, versão, notas). */
    metadata?: Record<string, unknown>;
}

/**
 * Escopo agnóstico de uma revisão. `level` descreve o nível principal (global,
 * tenant, prompt, workflow, etc). `identifiers` e `path` permitem estruturar
 * hierarquias arbitrárias sem acoplar ao domínio específico.
 */
export interface ContextRevisionScope {
    /** Nome principal do escopo (ex.: 'global', 'tenant', 'prompt'). */
    level: string;
    /** Mapa de identificadores relevantes (ex.: { tenantId, repositoryId, directoryId }). */
    identifiers?: Record<string, string>;
    /** Caminho hierárquico opcional (tenant → projeto → prompt, etc.). */
    path?: Array<{ level: string; id: string }>;
    /** Metadados adicionais para o domínio. */
    metadata?: Record<string, unknown>;
}

/**
 * Convenção recomendada para ContextRevisionScope.identifiers:
 * - tenantId: sempre presente para isolamento multi-tenant
 * - Outros identificadores podem ser adicionados conforme necessário
 */

/** Identifica a origem/autoria de uma revisão (humano, automação, serviço). */
export interface ContextRevisionActor extends ActorRef {
    kind: 'human' | 'automation' | 'system' | string;
    contact?: string; // Campo específico para ContextRevisionActor
}

/**
 * ContextRevisionLogEntry - EVENTO (COMMIT) QUE INTRODUZ/ATUALIZA REQUIREMENTS + PAYLOAD
 *
 * Representa um evento versionado que introduz ou atualiza requirements e seu payload
 * associado. É o "commit" no git do context engineering - captura mudanças em um
 * ponto no tempo.
 *
 * SEMÂNTICA: Este é o evento/histórico de mudanças. É a "fonte da verdade" para
 * rastrear evolução de requirements ao longo do tempo. Contém o payload completo
 * e metadados de auditoria.
 */
export interface ContextRevisionLogEntry {
    /** Identificador do commit. */
    revisionId: string;
    /** Commit pai (para histórico e merges). */
    parentRevisionId?: string;
    /** Escopo (domínio) no qual o commit se aplica. */
    scope: ContextRevisionScope;
    /** Tipo da entidade versionada (prompt, workflow, knowledge...). */
    entityType: string;
    /** Identificador estável do item versionado. */
    entityId: string;
    /** Payload armazenado (estrutura livre, geralmente contendo requirements). */
    payload: Record<string, unknown>;
    /** Lista opcional de requisitos de contexto serializados. */
    requirements?: ContextRequirement[];
    /** Itens de conhecimento referenciados pelo commit. */
    knowledgeRefs?: Array<{ itemId: string; version?: string }>;
    /** Origem/autoria desse commit. */
    origin?: ContextRevisionActor;
    /** Timestamp em epoch millis. */
    createdAt: number;
    /** Metadados adicionais. */
    metadata?: Record<string, unknown>;
}

/** Pacote final entregue ao LLM com camadas, recursos e requisitos. */
export interface ContextPack {
    id: string;
    domain: ContextDomain;
    version: string;
    createdAt: number;
    createdBy: string;
    budget: TokenBudget;
    layers: ContextLayer[];
    provenance?: LineageRecord[];
    constraints?: RetrievalQuery['constraints'];
    resources?: ContextResourceRef[];
    /** requiredActions EXTENDE A WHITELIST DE GOVERNANÇA
     *
     * Lista de ações que podem ser executadas pelo agente neste contexto.
     * Funciona como extensão da whitelist definida em dependencies - especifica
     * exatamente quais ações estão permitidas e seus parâmetros de execução.
     */
    requiredActions?: ContextActionDescriptor[];
    dependencies?: ContextDependency[];
    metadata?: Record<string, unknown>;
}

/** Builder responsável por transformar candidatos + query em um ContextPack. */
export interface ContextPackBuilder {
    buildPack(input: {
        query: RetrievalQuery;
        candidates: Candidate[];
        existingContext?: RuntimeContextSnapshot;
    }): Promise<ContextPack>;
}

/** Estrutura auxiliar para mensagens que não são plain-text. */
export interface StructuredContent {
    type: string;
    data: unknown;
}

/** Mensagem armazenada no runtime (histórico da sessão). */
export interface SessionMessage {
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string | StructuredContent;
    timestamp: number;
    metadata?: Record<string, unknown>;
}

/** Estado de execução do agente/conversação. */
export interface ExecutionState {
    phase: 'planning' | 'execution' | 'responded' | 'error' | 'idle';
    lastUserIntent?: string;
    pendingActions?: string[];
    currentStepId?: string;
    iterationCount?: number;
    totalIterations?: number;
    metadata?: Record<string, unknown>;
}

/** Entidade mencionada no contexto (usuário, equipe, sistema externo...). */
export interface Entity {
    id: string;
    type: string;
    displayName?: string;
    lastUsed?: number;
    metadata?: Record<string, unknown>;
}

/** Snapshot completo do runtime/conversa armazenado pelo Context-OS. */
export interface RuntimeContextSnapshot {
    sessionId: string;
    threadId: string;
    tenantId: string;
    createdAt: number;
    updatedAt: number;
    state: ExecutionState;
    messages: SessionMessage[];
    knowledgeRefs: Array<{
        packId: string;
        layer: ContextLayerKind;
        itemRefs: string[];
    }>;
    entities: Record<string, Entity[]>;
    metadata?: Record<string, unknown>;
}

/** Parâmetros para iniciar uma sessão de runtime. */
export interface SessionInit {
    tenantId: string;
    userId?: string;
    threadId?: string;
    initialState?: Partial<ExecutionState>;
    metadata?: Record<string, unknown>;
}

/** Patch para atualizar uma sessão existente (estado, mensagens, entidades...). */
export interface ContextUpdatePatch {
    state?: Partial<ExecutionState>;
    messagesAppend?: SessionMessage[];
    messagesUpdate?: Array<{
        id: string;
        content?: SessionMessage['content'];
        metadata?: Record<string, unknown>;
    }>;
    resourcesFetch?: ContextResourceRef[];
    entitiesUpsert?: Record<string, Entity[]>;
    knowledgeRefsAppend?: RuntimeContextSnapshot['knowledgeRefs'];
    metadata?: Record<string, unknown>;
}

/** Repositório/serviço responsável por persistir snapshots de runtime. */
export interface RuntimeContextStore {
    initSession(params: SessionInit): Promise<RuntimeContextSnapshot>;
    getSession(sessionId: string): Promise<RuntimeContextSnapshot>;
    updateSession(sessionId: string, update: ContextUpdatePatch): Promise<void>;
    archiveSession(sessionId: string): Promise<void>;
}

/** Esquema de uma ferramenta (MCP, HTTP, interna...) utilizada pelo contexto. */
export interface ToolSchema {
    name: string;
    description?: string;
    inputSchema: unknown;
    outputSchema?: unknown;
    examples?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
}

/** Descriptor reutilizável de ferramentas disponível para o agente. */
export interface ToolDescriptor {
    id: string;
    description: string;
    schema: ToolSchema;
    metadata?: Record<string, unknown>;
}

/** Resultado da execução de uma ação de contexto. */
export interface ContextActionExecutionResult {
    success: boolean;
    output?: unknown;
    resources?: ContextResourceRef[];
    layerPatches?: Partial<Record<ContextLayerKind, unknown>>;
    telemetry?: Record<string, unknown>;
}

/** Contexto fornecido para executar uma ação específica. */
export interface ContextActionExecutionContext {
    action: ContextActionDescriptor;
    pack: ContextPack;
    context: LayerInputContext;
    runtime?: RuntimeContextSnapshot;
}

/** Executor responsável por rodar ações adicionais ligadas ao pack. */
export interface ContextActionExecutor {
    supports(action: ContextActionDescriptor): boolean;
    execute(
        params: ContextActionExecutionContext,
    ): Promise<ContextActionExecutionResult>;
}

/**
 * ---------------------------------------------------------------------------
 * MCP (Model Context Protocol) integration
 * ---------------------------------------------------------------------------
 */

/** Referência a uma ferramenta registrada num servidor MCP. */
export interface MCPToolReference {
    mcpId: string;
    toolName: string;
    description?: string;
    schema?: ToolSchema;
    metadata?: Record<string, unknown>;
    lastValidatedAt?: number;
}

/** Estado de saúde de um servidor MCP. */
export type MCPStatus = 'available' | 'degraded' | 'unavailable';

/** Registro completo de um servidor MCP e suas ferramentas. */
export interface MCPRegistration {
    id: string;
    title?: string;
    endpoint: string;
    description?: string;
    status: MCPStatus;
    authConfig?: {
        type: 'api_key' | 'oauth2' | 'jwt' | 'custom';
        secretId?: string;
        metadata?: Record<string, unknown>;
    };
    tools: MCPToolReference[];
    lastHeartbeatAt?: number;
    metadata?: Record<string, unknown>;
}

/** Solicitação de invocação de uma ferramenta MCP. */
export interface MCPInvocationRequest {
    registry: MCPRegistration;
    tool: MCPToolReference;
    input: Record<string, unknown>;
    runtimeMetadata?: Record<string, unknown>;
}

/** Resultado da invocação de uma ferramenta MCP. */
export interface MCPInvocationResult {
    success: boolean;
    output?: Record<string, unknown> | string | null;
    error?: {
        code?: string;
        message: string;
        details?: Record<string, unknown>;
    };
    latencyMs: number;
    metadata?: Record<string, unknown>;
}

/** Cliente responsável por orquestrar chamadas MCP. */
export interface MCPClient {
    invoke(request: MCPInvocationRequest): Promise<MCPInvocationResult>;
    healthCheck?(mcpId: string): Promise<MCPStatus>;
}

/** Identidade do agente responsável por executar a entrega. */
export interface AgentIdentity {
    name: string;
    description?: string;
    role?: string;
    policies?: string[];
    language?: string;
    constraints?: string[];
    metadata?: Record<string, unknown>;
}

/** Solicitação de entrega de contexto/ação para um agente. */
export interface DeliveryRequest {
    userIntent: string;
    agentIdentity: AgentIdentity;
    toolset: ToolDescriptor[];
    format?: 'chat' | 'json' | 'xml' | 'custom';
    maxTokens?: number;
    metadata?: Record<string, unknown>;
}

/** Payload final enviado ao modelo ou sistema de entrega. */
export interface DeliveryPayload {
    systemMessage: string;
    userMessage: string;
    toolSchemas?: ToolSchema[];
    attachments?: Array<{ type: string; data: unknown }>;
    onDemandResources?: ContextResourceRef[];
    diagnostics?: Record<string, unknown>;
}

/** Adaptador que transforma o ContextPack em payload entregável e executa a entrega. */
export interface DeliveryAdapter<TOutput = unknown> {
    buildPayload(
        pack: ContextPack,
        runtime: RuntimeContextSnapshot,
        request: DeliveryRequest,
    ): DeliveryPayload;
    deliver(payload: DeliveryPayload): Promise<TOutput>;
}

/** Evento de telemetria registrado pelo Context-OS. */
/** Evento emitido para telemetria/observabilidade do contexto. */
export interface ContextEvent {
    type:
        | 'SELECTION'
        | 'DELIVERY'
        | 'UPDATE'
        | 'ERROR'
        | 'ACTION_STARTED'
        | 'ACTION_COMPLETED'
        | 'ACTION_FAILED';
    sessionId: string;
    packId?: string;
    tenantId: string;
    userId?: string;
    budget?: TokenBudget;
    groundednessScore?: number;
    tokensUsed?: number;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
    timestamp: number;
}

/** Alerta de drift de contexto (quando uso/resultado sai do esperado). */
export interface DriftAlert {
    domain: ContextDomain;
    severity: 'low' | 'medium' | 'high';
    description: string;
    detectedAt: number;
    recommendedAction?: string;
    metadata?: Record<string, unknown>;
}

/** Métricas agregadas produzidas pela telemetria. */
export interface ContextMetrics {
    usageByDomain: Record<ContextDomain, number>;
    avgTokensPerLayer: Record<ContextLayerKind, number>;
    groundedness: { mean: number; p95: number };
    driftAlerts: DriftAlert[];
    metadata?: Record<string, unknown>;
}

/** Interface de telemetria utilizada pelo Context-OS. */
export interface ContextTelemetry {
    record(event: ContextEvent): Promise<void>;
    report(params?: Record<string, unknown>): Promise<ContextMetrics>;
}

/**
 * ---------------------------------------------------------------------------
 * Tri-layer / Pack assembly helpers
 * ---------------------------------------------------------------------------
 */

/** Entrada padrão para builders de camada (domínio, intent, candidatos...). */
export interface LayerInputContext {
    domain: ContextDomain;
    taskIntent: string;
    retrieval: RetrievalResult;
    runtimeContext?: RuntimeContextSnapshot;
    deliveryRequest?: DeliveryRequest;
    metadata?: Record<string, unknown>;
}

/** Opções comuns para construção de camadas (limite de tokens, prioridade, etc.). */
export interface LayerBuildOptions {
    maxTokens?: number;
    priority?: number;
    residence?: LayerResidence;
    includeDiagnostics?: boolean;
}

/** Diagnósticos retornados após a construção de uma camada. */
export interface LayerBuildDiagnostics {
    tokensBefore?: number;
    tokensAfter?: number;
    compactionStrategy?: string;
    notes?: string;
}

/** Resultado ao construir uma camada individual. */
export interface LayerBuildResult {
    layer: ContextLayer;
    resources?: ContextResourceRef[];
    diagnostics?: LayerBuildDiagnostics;
}

/** Builder de camada (core, catalog, active). */
export interface ContextLayerBuilder {
    stage: Extract<ContextLayerKind, 'core' | 'catalog' | 'active'>;
    build(
        input: LayerInputContext,
        options?: LayerBuildOptions,
    ): Promise<LayerBuildResult>;
}

/** Passo de pipeline responsável por montar uma camada específica. */
export interface PackAssemblyStep {
    builder: ContextLayerBuilder;
    description?: string;
}

/** Pipeline completo que monta o ContextPack (sequência de steps). */
export interface PackAssemblyPipeline {
    steps: PackAssemblyStep[];
    execute(
        input: LayerInputContext,
        options?: LayerBuildOptions,
    ): Promise<{
        pack: ContextPack;
        resources: ContextResourceRef[];
        diagnostics?: Record<string, unknown>;
    }>;
}

/**
 * ---------------------------------------------------------------------------
 * Domain bundles (snapshot + builders + delivery)
 * ---------------------------------------------------------------------------
 */

/** Papel da mensagem num prompt (system, user, assistant, etc.). */
export type PromptRole = 'system' | 'user' | 'assistant' | 'tool' | string;

/** Escopo em que um override de prompt será aplicado. */
export type PromptScope =
    | 'core'
    | 'catalog'
    | 'active'
    | 'fallback'
    | 'meta'
    | string;
/** Override de prompt aplicado a um domínio/contexto específico. */
export interface PromptOverride {
    id: string;
    role: PromptRole;
    scope: PromptScope;
    content: string;
    metadata?: Record<string, unknown>;
    requiredActions?: ContextActionDescriptor[];
    dependencies?: ContextDependency[];
}

/** Snapshot versionado de um domínio (configuração + prompts + recursos). */
export interface DomainSnapshot<TConfig = Record<string, unknown>> {
    id: string;
    domain: ContextDomain;
    version: string;
    createdAt: number;
    config: TConfig;
    promptOverrides?: PromptOverride[];
    actions?: ContextActionDescriptor[];
    resources?: ContextResourceRef[];
    metadata?: Record<string, unknown>;
}

/** Conjunto de builders usados para montar contexto de um domínio. */
export interface DomainBundleBuilders {
    core: ContextLayerBuilder;
    catalog?: ContextLayerBuilder;
    active?: ContextLayerBuilder;
    extras?: ContextLayerBuilder[];
}

/** Componentes que compõem um bundle de domínio (pipeline, ações, delivery). */
export interface DomainBundleComponents<TDelivery = unknown> {
    builders: DomainBundleBuilders;
    pipeline: PackAssemblyPipeline;
    packBuilder: ContextPackBuilder;
    actions?: ContextActionDescriptor[];
    dependencies?: ContextDependency[];
    deliveryAdapter?: DeliveryAdapter<TDelivery>;
    metadata?: Record<string, unknown>;
}

/** Estrutura final agregando snapshot + componentes + metadados de domínio. */
export interface DomainBundle<
    TSnapshot extends DomainSnapshot = DomainSnapshot,
    TDelivery = unknown,
> {
    id: string;
    domain: ContextDomain;
    version: string;
    snapshot: TSnapshot;
    components: DomainBundleComponents<TDelivery>;
    metadata?: Record<string, unknown>;
}
