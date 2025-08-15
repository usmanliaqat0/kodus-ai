/**
 * Exemplo de uso do MCP Adapter com reconexão automática
 *
 * Este exemplo demonstra como o MCP adapter agora lida com:
 * - Reconexão automática quando a conexão é perdida
 * - Múltiplas chamadas consecutivas
 * - Recuperação de estado após falhas
 */

import { createMCPAdapter } from './index.js';

async function demonstrateConnectionRecovery() {
    const mcpAdapter = createMCPAdapter({
        servers: [
            {
                name: 'filesystem',
                type: 'http',
                url: 'http://localhost:3000',
            },
            {
                name: 'github',
                type: 'http',
                url: 'http://localhost:3001',
            },
        ],
        onError: (error, serverName) => {
            console.error(`MCP server ${serverName} error:`, error.message);
        },
    });

    try {
        // Primeira conexão
        console.log('🔌 Conectando aos servidores MCP...');
        await mcpAdapter.connect();
        console.log('✅ Conectado com sucesso!');

        // Primeira chamada - deve funcionar
        console.log('📋 Listando tools pela primeira vez...');
        const tools1 = await mcpAdapter.getTools();
        console.log(`✅ Encontradas ${tools1.length.toString()} tools`);

        // Segunda chamada - deve funcionar mesmo se conexão foi perdida
        console.log('📋 Listando tools pela segunda vez...');
        const tools2 = await mcpAdapter.getTools();
        console.log(`✅ Encontradas ${tools2.length.toString()} tools`);

        // Terceira chamada - deve funcionar
        console.log('📋 Listando tools pela terceira vez...');
        const tools3 = await mcpAdapter.getTools();
        console.log(`✅ Encontradas ${tools3.length.toString()} tools`);

        // Verificar se tool existe
        console.log('🔍 Verificando se tool existe...');
        const hasTool = await mcpAdapter.hasTool('read_file');
        console.log(`✅ Tool existe: ${hasTool.toString()}`);

        // Executar tool
        if (hasTool) {
            console.log('⚡ Executando tool...');
            const result = await mcpAdapter.executeTool('read_file', {
                path: '/test.txt',
            });
            console.log('✅ Tool executada com sucesso:', result);
        }
    } catch (error) {
        console.error('❌ Erro durante demonstração:', error);
    } finally {
        // Sempre desconectar
        console.log('🔌 Desconectando...');
        mcpAdapter.disconnect();
        console.log('✅ Desconectado!');
    }
}

// Executar demonstração.toString()
if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
    demonstrateConnectionRecovery().catch(console.error);
}

export { demonstrateConnectionRecovery };
