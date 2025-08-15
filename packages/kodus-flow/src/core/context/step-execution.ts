/**
 * @file step-execution.ts
 * @description Step Execution Components - Rastreamento estruturado de execução
 *
 * Este arquivo implementa componentes para rastreamento de execução inspirados no AI SDK:
 * - StepExecution: Rastreamento estruturado de execução
 * - EnhancedMessageContext: Contexto inteligente com integração automática
 * - ContextManager: API unificada para session/state/memory
 *
 * 📊 ORGANIZAÇÃO DOS NAMESPACES:
 *
 * ⚡ STATE NAMESPACES:
 * - "planner": Estado do planner (planos, steps, resultados)
 * - "ai_sdk": Mensagens e contexto atual do AI SDK
 * - "execution": Valores de contexto da execução atual
 * - "runtime": Dados temporários de execução
 * - "tools": Estado das ferramentas (usage, errors, performance)
 *
 * 💬 SESSION ENTRIES:
 * - "message": Mensagens do usuário/assistente
 * - "tool_call": Chamadas de ferramentas
 * - "planner_step": Passos do planner
 * - "error": Erros e eventos do sistema
 * - "enhanced-context": Dados do contexto enriquecido
 *
 * 🧠 MEMORY TYPES:
 * - "conversation": Histórico de conversas significativas
 * - "user-preferences": Preferências do usuário
 * - "execution-hints": Dicas de execução
 * - "learning-context": Contexto de aprendizado
 * - "relevant-memories": Memórias relevantes para consulta
 */

import { createLogger } from '../../observability/index.js';
import type { AgentContext } from '../types/agent-types.js';
import type { AgentThought, AgentAction } from '../types/agent-types.js';
import type {
    ActionResult,
    ResultAnalysis,
} from '../../engine/planning/planner-factory.js';

// ============================================================================
// 0. NAMESPACE CONSTANTS
// ============================================================================

export const STATE_NAMESPACES = {
    PLANNER: 'planner',
    AI_SDK: 'ai_sdk',
    EXECUTION: 'execution',
    RUNTIME: 'runtime',
    TOOLS: 'tools',
} as const;

export const SESSION_TYPES = {
    MESSAGE: 'message',
    TOOL_CALL: 'tool_call',
    PLANNER_STEP: 'planner_step',
    ERROR: 'error',
    ENHANCED_CONTEXT: 'enhanced-context',
} as const;

export const MEMORY_TYPES = {
    CONVERSATION: 'conversation',
    USER_PREFERENCES: 'user-preferences',
    EXECUTION_HINTS: 'execution-hints',
    LEARNING_CONTEXT: 'learning-context',
    RELEVANT_MEMORIES: 'relevant-memories',
} as const;

// ============================================================================
// 1. STEP EXECUTION (AI SDK CONCEPT)
// ============================================================================

export interface AgentStepResult {
    stepId: string;
    iteration: number;
    thought: AgentThought;
    action: AgentAction;
    status: string;
    result: ActionResult;
    observation: ResultAnalysis;
    duration: number;
    metadata: {
        contextOperations: Array<{
            layer: 'state' | 'session' | 'memory';
            operation: string;
            data: unknown;
        }>;
        toolCalls: Array<{
            toolName: string;
            input: unknown;
            result: unknown;
            duration: number;
        }>;
        performance: {
            thinkDuration: number;
            actDuration: number;
            observeDuration: number;
        };
    };
}

export class StepExecution {
    private steps: Map<string, AgentStepResult> = new Map();
    private currentStepId: string | null = null;
    private logger = createLogger('step-execution');

    startStep(iteration: number): string {
        const stepId = `step-${iteration.toString()}-${Date.now().toString()}`;
        this.currentStepId = stepId;

        this.steps.set(stepId, {
            stepId,
            iteration,
            thought: {
                reasoning: '',
                action: { type: 'final_answer', content: '' },
            },
            status: 'final_answer',
            action: { type: 'final_answer', content: '' },
            result: { type: 'error', error: 'Not executed yet' },
            observation: {
                isComplete: false,
                isSuccessful: false,
                feedback: '',
                shouldContinue: false,
            },
            duration: 0,
            metadata: {
                contextOperations: [],
                toolCalls: [],
                performance: {
                    thinkDuration: 0,
                    actDuration: 0,
                    observeDuration: 0,
                },
            },
        });

        this.logger.debug('Step started', { stepId, iteration });
        return stepId;
    }

    updateStep(
        stepId: string,
        updates: Partial<
            Pick<
                AgentStepResult,
                'thought' | 'action' | 'result' | 'observation' | 'duration'
            >
        >,
    ): void {
        const step = this.steps.get(stepId);
        if (step) {
            Object.assign(step, updates);
            this.logger.debug('Step updated', {
                stepId,
                updates: Object.keys(updates),
            });
        }
    }

    addContextOperation(
        stepId: string,
        layer: 'state' | 'session' | 'memory',
        operation: string,
        data: unknown,
    ): void {
        const step = this.steps.get(stepId);
        if (step) {
            step.metadata.contextOperations.push({ layer, operation, data });
            this.logger.debug('Context operation added', {
                stepId,
                layer,
                operation,
            });
        }
    }

    addToolCall(
        stepId: string,
        toolName: string,
        input: unknown,
        result: unknown,
        duration: number,
    ): void {
        const step = this.steps.get(stepId);
        if (step) {
            step.metadata.toolCalls.push({ toolName, input, result, duration });
            this.logger.debug('Tool call added', {
                stepId,
                toolName,
                duration,
            });
        }
    }

    getStep(stepId: string): AgentStepResult | undefined {
        return this.steps.get(stepId);
    }

    getAllSteps(): AgentStepResult[] {
        return Array.from(this.steps.values());
    }

    getCurrentStep(): AgentStepResult | undefined {
        return this.currentStepId
            ? this.steps.get(this.currentStepId)
            : undefined;
    }

    getExecutionSummary(): {
        totalSteps: number;
        successfulSteps: number;
        failedSteps: number;
        averageDuration: number;
        totalContextOperations: number;
        totalToolCalls: number;
    } {
        const steps = this.getAllSteps();
        const successfulSteps = steps.filter(
            (s) => s.observation.isSuccessful,
        ).length;
        const failedSteps = steps.filter(
            (s) => !s.observation.isSuccessful,
        ).length;
        const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0);
        const totalContextOperations = steps.reduce(
            (sum, s) => sum + s.metadata.contextOperations.length,
            0,
        );
        const totalToolCalls = steps.reduce(
            (sum, s) => sum + s.metadata.toolCalls.length,
            0,
        );

        return {
            totalSteps: steps.length,
            successfulSteps,
            failedSteps,
            averageDuration:
                steps.length > 0 ? totalDuration / steps.length : 0,
            totalContextOperations,
            totalToolCalls,
        };
    }
}

// ============================================================================
// 2. ENHANCED MESSAGE CONTEXT (AI SDK CONCEPT)
// ============================================================================

export interface MessageEntry {
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: unknown;
    timestamp: number;
    metadata?: Record<string, unknown>;
    stepId?: string;
}

export class EnhancedMessageContext {
    private messages: MessageEntry[] = [];
    private contextManager: ContextManager;
    private logger = createLogger('enhanced-message-context');

    constructor(contextManager: ContextManager) {
        this.contextManager = contextManager;
    }

    /**
     * ⭐ AI SDK CONCEPT: Add message with automatic persistence
     * Integra automaticamente com State, Session e Memory
     */
    // TODO: Wwhy not used
    async addMessage(
        role: MessageEntry['role'],
        content: unknown,
        context: AgentContext,
        metadata?: MessageEntry['metadata'],
        stepId?: string,
    ): Promise<string> {
        const messageId = `msg-${Date.now().toString()}-${Math.random().toString(36).slice(2, 11)}`;

        const message: MessageEntry = {
            id: messageId,
            role,
            content,
            timestamp: Date.now(),
            metadata,
            stepId,
        };

        this.messages.push(message);

        // ⭐ AI SDK CONCEPT: Integração automática com context
        try {
            // Adicionar à session (histórico de conversa)
            await context.session.addEntry(
                {
                    type: 'message',
                    role,
                    content:
                        typeof content === 'string'
                            ? content
                            : JSON.stringify(content),
                },
                { type: 'metadata', timestamp: message.timestamp, ...metadata },
            );

            // Adicionar ao state (memória de trabalho)
            await context.state.set(STATE_NAMESPACES.AI_SDK, 'last_message', {
                id: messageId,
                role,
                content:
                    typeof content === 'string'
                        ? content
                        : JSON.stringify(content),
                timestamp: message.timestamp,
                stepId,
            });

            // Adicionar à memory (armazenamento de longo prazo) se for significativo
            if (
                role === 'user' ||
                (role === 'assistant' &&
                    typeof content === 'string' &&
                    content.length > 50)
            ) {
                await context.memory.store({
                    type: MEMORY_TYPES.CONVERSATION,
                    content:
                        typeof content === 'string'
                            ? content
                            : JSON.stringify(content),
                    metadata: {
                        role,
                        timestamp: message.timestamp,
                        stepId,
                        ...metadata,
                    },
                });
            }

            // Registrar operação de context no step atual
            if (stepId) {
                this.contextManager.recordContextOperation(
                    stepId,
                    'session',
                    'add_message',
                    {
                        messageId,
                        role,
                        contentLength:
                            typeof content === 'string'
                                ? content.length
                                : JSON.stringify(content).length,
                    },
                );
            }

            this.logger.debug('Message added with auto-persistence', {
                messageId,
                role,
                stepId,
            });
        } catch (error) {
            this.logger.warn('Failed to persist message to context:', {
                error: String(error),
            });
        }

        return messageId;
    }

    /**
     * ⭐ AI SDK CONCEPT: Obter contexto para o modelo
     * Integra contexto relevante das três camadas
     */
    async getContextForModel(
        context: AgentContext,
        query?: string,
    ): Promise<string> {
        const contextParts: string[] = [];

        try {
            // 1. MEMORY: Buscar memórias relevantes
            if (query) {
                const memories = await context.memory.search(query, 3);
                if (memories.length > 0) {
                    contextParts.push('\n📚 Conhecimento relevante:');
                    memories.forEach((memory, i) => {
                        const memoryStr =
                            typeof memory === 'string'
                                ? memory
                                : JSON.stringify(memory);
                        contextParts.push(
                            `${(i + 1).toString()}. ${memoryStr}`,
                        );
                    });
                }
            }

            // 2. SESSION: Histórico recente de conversa
            const sessionHistory = await context.session.getHistory();
            if (sessionHistory.length > 0) {
                contextParts.push('\n💬 Conversa recente:');
                sessionHistory.slice(-3).forEach((entry, i) => {
                    const formattedEntry = this.formatSessionEntry(entry);
                    if (formattedEntry) {
                        contextParts.push(
                            `${(i + 1).toString()}. ${formattedEntry}`,
                        );
                    }
                });
            }

            // 3. STATE: Estado atual de trabalho
            const workingState = context.state.getNamespace('execution');
            if (workingState && workingState.size > 0) {
                contextParts.push('\n⚡ Estado atual:');
                let count = 0;
                for (const [key, value] of workingState) {
                    if (count >= 3) break;
                    const valueStr =
                        typeof value === 'string'
                            ? value
                            : JSON.stringify(value);
                    contextParts.push(`- ${key}: ${valueStr}`);
                    count++;
                }
            }

            // 4. MESSAGES: Mensagens da sessão atual
            if (this.messages.length > 0) {
                contextParts.push('\n📝 Mensagens da sessão:');
                this.messages.slice(-5).forEach((msg, i) => {
                    const contentStr =
                        typeof msg.content === 'string'
                            ? msg.content
                            : JSON.stringify(msg.content);
                    contextParts.push(
                        `${(i + 1).toString()}. [${msg.role}] ${contentStr.substring(0, 100)}...`,
                    );
                });
            }
        } catch (error) {
            this.logger.warn('Failed to build context for model:', {
                error: String(error),
            });
        }

        return contextParts.join('\n');
    }

    /**
     * ✅ NEW: Format session entry for human-readable display
     */
    private formatSessionEntry(entry: unknown): string | null {
        if (!entry || typeof entry !== 'object') {
            return null;
        }

        const entryObj = entry as Record<string, unknown>;

        // Extract user input and assistant output
        const input = entryObj.input;
        const output = entryObj.output;

        // Format based on entry type
        if (input && typeof input === 'object') {
            const inputObj = input as Record<string, unknown>;

            // Handle different input types
            if (inputObj.type === 'memory_context_request') {
                const userInput = inputObj.input as string;
                return `User: "${userInput}"`;
            }

            if (inputObj.type === 'execution_step') {
                const thought = inputObj.thought as string;
                return `Agent: ${thought}`;
            }

            if (inputObj.type === 'plan_created') {
                const goal = inputObj.goal as string;
                return `Planning: "${goal}"`;
            }

            if (inputObj.type === 'plan_completed') {
                const synthesized =
                    output && typeof output === 'object'
                        ? ((output as Record<string, unknown>)
                              .synthesized as string)
                        : 'Completed';
                return `Response: "${synthesized}"`;
            }

            if (inputObj.type === 'step_execution_start') {
                const tool = inputObj.tool as string;
                return `Tool: ${tool}`;
            }
        }

        // Fallback: try to extract meaningful content
        if (output && typeof output === 'object') {
            const outputObj = output as Record<string, unknown>;
            if (outputObj.synthesized) {
                return `Response: "${outputObj.synthesized as string}"`;
            }
            if (outputObj.observation) {
                return `Result: "${outputObj.observation as string}"`;
            }
        }

        // If we have a simple string input/output
        if (typeof input === 'string' && input.length > 0) {
            return `User: "${input.substring(0, 50)}..."`;
        }

        return null;
    }

    /**
     * ⭐ AI SDK CONCEPT: Obter apenas resultados de ferramentas
     */
    getToolResults(): unknown[] {
        return this.messages
            .filter((msg) => msg.role === 'tool')
            .map((msg) => msg.content);
    }

    /**
     * ⭐ AI SDK CONCEPT: Limpar mensagens antigas
     */
    cleanupOldMessages(maxAge: number = 24 * 60 * 60 * 1000): void {
        const cutoff = Date.now() - maxAge;
        this.messages = this.messages.filter((msg) => msg.timestamp > cutoff);
        this.logger.debug('Old messages cleaned up', {
            before:
                this.messages.length +
                this.messages.filter((m) => m.timestamp <= cutoff).length,
            after: this.messages.length,
        });
    }

    getMessageCount(): number {
        return this.messages.length;
    }

    getMessagesByRole(role: MessageEntry['role']): MessageEntry[] {
        return this.messages.filter((msg) => msg.role === role);
    }
}

// ============================================================================
// 3. CONTEXT MANAGER (AI SDK CONCEPT)
// ============================================================================

export class ContextManager {
    private stepExecution: StepExecution;
    private messageContext: EnhancedMessageContext;
    private logger = createLogger('context-manager');

    constructor(stepExecution: StepExecution) {
        this.stepExecution = stepExecution;
        this.messageContext = new EnhancedMessageContext(this);
    }

    /**
     * ⭐ AI SDK CONCEPT: API unificada para operações de context
     */
    async addToContext(
        type: 'state' | 'session' | 'memory',
        key: string,
        value: unknown,
        context: AgentContext,
        stepId?: string,
    ): Promise<void> {
        try {
            switch (type) {
                case 'state':
                    await context.state.set('ai_sdk', key, value);
                    if (stepId) {
                        this.recordContextOperation(stepId, 'state', 'set', {
                            key,
                            value,
                        });
                    }
                    break;

                case 'session':
                    await context.session.addEntry(
                        { type: 'ai_sdk', key, data: value },
                        { type: 'metadata', timestamp: Date.now() },
                    );
                    if (stepId) {
                        this.recordContextOperation(
                            stepId,
                            'session',
                            'add_entry',
                            { key, value },
                        );
                    }
                    break;

                case 'memory':
                    await context.memory.store({
                        type: 'ai_sdk',
                        content:
                            typeof value === 'string'
                                ? value
                                : JSON.stringify(value),
                        metadata: { key, timestamp: Date.now() },
                    });
                    if (stepId) {
                        this.recordContextOperation(stepId, 'memory', 'store', {
                            type: 'store',
                            key,
                        });
                    }
                    break;
            }

            this.logger.debug('Context operation completed', {
                type,
                key,
                stepId,
            });
        } catch (error) {
            this.logger.warn(`Failed to add to ${type} context:`, {
                error: String(error),
            });
        }
    }

    /**
     * ⭐ AI SDK CONCEPT: Obter contexto relevante para o modelo
     */
    async getRelevantContext(
        context: AgentContext,
        query?: string,
    ): Promise<string> {
        return this.messageContext.getContextForModel(context, query);
    }

    /**
     * ⭐ AI SDK CONCEPT: Registrar operação de context
     */
    recordContextOperation(
        stepId: string,
        layer: 'state' | 'session' | 'memory',
        operation: string,
        data: unknown,
    ): void {
        this.stepExecution.addContextOperation(stepId, layer, operation, data);
    }

    /**
     * ⭐ AI SDK CONCEPT: Adicionar mensagem com integração automática
     */
    async addMessage(
        role: MessageEntry['role'],
        content: unknown,
        context: AgentContext,
        metadata?: Record<string, unknown>,
        stepId?: string,
    ): Promise<string> {
        return this.messageContext.addMessage(
            role,
            content,
            context,
            metadata,
            stepId,
        );
    }

    /**
     * ⭐ AI SDK CONCEPT: Obter estatísticas de context
     */
    async getContextStats(context: AgentContext): Promise<{
        sessionEntries: number;
        stateKeys: number;
        memoryItems: number;
        messageCount: number;
    }> {
        try {
            const sessionHistory = await context.session.getHistory();
            const stateKeys = context.state.getNamespace('ai_sdk');
            const messageCount = this.messageContext.getMessageCount();

            return {
                sessionEntries: sessionHistory.length || 0,
                stateKeys: stateKeys?.size ?? 0,
                memoryItems: 0, // Memory doesn't have a direct count method
                messageCount,
            };
        } catch (error) {
            this.logger.warn('Failed to get context stats:', {
                error: String(error),
            });
            return {
                sessionEntries: 0,
                stateKeys: 0,
                memoryItems: 0,
                messageCount: 0,
            };
        }
    }

    getMessageContext(): EnhancedMessageContext {
        return this.messageContext;
    }

    getStepExecution(): StepExecution {
        return this.stepExecution;
    }
}
