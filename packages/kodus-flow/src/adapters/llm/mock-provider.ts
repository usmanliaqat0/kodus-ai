import type { LLMAdapter, LLMRequest, LLMResponse } from './index.js';

export function createMockLLMProvider(): LLMAdapter {
    return {
        call(request: LLMRequest): Promise<LLMResponse> {
            // Mock simples que retorna uma resposta baseada no conteúdo
            const lastMessage = request.messages[request.messages.length - 1];
            const content = lastMessage?.content ?? '';

            // Simula diferentes tipos de resposta baseado no conteúdo
            if (
                content.includes('tool_call') ||
                content.includes('calculator') ||
                content.includes('calculate')
            ) {
                return Promise.resolve({
                    content: 'I need to use a tool to calculate this',
                    toolCalls: [
                        {
                            name: 'calculator',
                            arguments: { expression: '2+2' },
                        },
                    ],
                });
            }

            if (
                content.includes('final_answer') ||
                content.includes('hello') ||
                content.includes('say')
            ) {
                return Promise.resolve({
                    content:
                        'This is my final answer: Hello! I am working correctly.',
                });
            }

            // Resposta padrão para testes
            return Promise.resolve({
                content:
                    'Mock response for testing. I understand the request and will process it accordingly.',
            });
        },

        analyzeContext(
            _pergunta: string,
            availableTools: Array<{ name: string; description?: string }>,
        ) {
            return Promise.resolve({
                intent: 'test',
                urgency: 'normal' as const,
                complexity: 'simple' as const,
                selectedTool: availableTools[0]?.name ?? 'default_tool',
                confidence: 0.8,
                reasoning: 'Mock analysis for testing',
            });
        },

        extractParameters(
            pergunta: string,
            toolName: string,
            context: unknown,
        ) {
            return Promise.resolve({
                query: pergunta,
                toolName,
                context: JSON.stringify(context),
            });
        },

        generateResponse(_result: unknown, originalQuestion: string) {
            return Promise.resolve(`Mock response for: ${originalQuestion}`);
        },

        getProvider() {
            return {
                name: 'mock-provider',
                version: '1.0.0',
                capabilities: ['text-generation', 'tool-calling'],
            };
        },
    };
}

// Alias para compatibilidade
export function createMockLLMAdapter(): LLMAdapter {
    return createMockLLMProvider();
}
