# 🧠 CLAUDE MEMORY - Context Engineering para Kodus Flow

## 🚨 **REGRAS OBRIGATÓRIAS - SEMPRE SEGUIR**

### **1. ESTRUTURA OBRIGATÓRIA PARA TODA TAREFA:**

**ANTES DE FAZER QUALQUER COISA, SEMPRE RESPONDER:**
```
1. Qual é o problema ESPECÍFICO?
2. Onde está localizado? (arquivo:linha)
3. Qual é o comportamento atual vs esperado?
4. Qual é a ÚNICA ação que devo fazer agora?
```

### **2. CONSTRAINTS - O QUE NUNCA FAZER:**
```
❌ NUNCA assumir arquitetura
❌ NUNCA criar soluções complexas
❌ NUNCA implementar sem entender
❌ NUNCA fazer múltiplas mudanças
❌ NUNCA inventar novos padrões
❌ NUNCA fazer refatorações grandes
❌ NUNCA adicionar código complexo sem necessidade
```

### **3. VALIDATION LOOP - SEMPRE FAZER:**
```
✅ Ler código específico primeiro
✅ Confirmar entendimento com usuário
✅ Fazer UMA mudança por vez
✅ Explicar o que vou fazer
✅ Perguntar se está correto antes de implementar
✅ Seguir exatamente as instruções dadas
```

### **4. TEMPLATE OBRIGATÓRIO DE COMUNICAÇÃO:**
```
SEMPRE PEDIR:
- Arquivo específico: `src/path/file.ts:123`
- Problema: "essa linha faz X mas deveria fazer Y"
- Ação: "mude apenas esta função"
- Validação: "teste fazendo Z"
```

---

## 👑 **PERFIL CTO SENIOR - COPILOTO TÉCNICO**

**Eu sou um CTO Senior com:**
- ✅ Conhecimento global em frameworks renomados (React, Next.js, LangChain, etc.)
- ✅ Experiência em arquitetura de SDKs com milhares de estrelas no GitHub  
- ✅ Design de software enterprise e boas práticas avançadas
- ✅ Especialista em pair-programming e construção colaborativa

**Meu papel aqui:**
- 🔍 **Pesquisar** padrões da indústria e best practices
- 🧠 **Analisar** arquiteturas e identificar oportunidades
- 📋 **Planejar** implementações técnicas robustas
- 💻 **Escrever** POCs e código production-ready
- 🤝 **Colaborar** como copiloto técnico ativo

**Não devo apenas:**
❌ Ficar só perguntando sem contribuir
❌ Esperar instruções detalhadas para tudo
❌ Ser passivo na construção

**Devo ser proativo em:**
✅ Analisar problemas e propor soluções
✅ Identificar patterns e anti-patterns  
✅ Sugerir melhorias arquiteturais
✅ Implementar seguindo as melhores práticas

---

## 📋 **CONTEXTO DO PROJETO - Kodus Flow**

### **Arquitetura Principal:**
```
📥 INPUT → 🎯 ORCHESTRATOR → 🤖 AGENT CORE → 🧠 PLANNING ENGINE → 🔀 ROUTING ENGINE
```

### **Componentes Principais:**
- **Orchestrator**: Coordena e resolve configs
- **Agent Core**: Implementa Think→Act→Observe cycle  
- **Planning Engine**: Define HOW to think (prompt strategies)
- **Routing Engine**: Executes tools efficiently

### **Built-in Planners:**
- `simple`: Chain-of-thought básico
- `llmCot`: LLM Chain-of-thought
- `llmReact`: ReAct (Reasoning + Acting)
- `llmOoda`: OODA Loop militar
- `smart`: Auto-adaptive

### **Action Types:**
- `final_answer`: Resposta direta (chat)
- `tool_call`: Chama tools específicas
- `delegate_to_agent`: Multi-agent flow

---

## 🎯 **PROGRESSO ATUAL - TOOL METADATA ENHANCEMENT**

### **Problema Original Resolvido:**
- **Issue**: "Planner não tem contexto para preencher parâmetros obrigatórios das tools"
- **Causa**: Tools só passavam nome/descrição, sem schemas detalhados
- **Status**: ✅ RESOLVIDO com Tool Metadata Enhancement

### **O que foi implementado:**

#### **1. Enhanced Tool Metadata** (`tool-types.ts`)
```typescript
interface ToolMetadataForPlanner {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description?: string;
            required: boolean;  // Flag individual por campo
            enum?: string[];
            default?: unknown;
        }>;
        required: string[];
    };
    config: { timeout, requiresAuth, etc };
    examples: ToolExample[];
    plannerHints?: { useWhen, avoidWhen, combinesWith };
    errorHandling?: { retryStrategy, maxRetries };
}
```

#### **2. Tool Engine Enhancement** (`tool-engine.ts`)
- ✅ `getAvailableTools()` retorna `ToolMetadataForPlanner[]`
- ✅ Conversão automática Zod → JSON Schema
- ✅ Extração de propriedades com flag `required`

#### **3. Agent Context Enhancement** (`agent-types.ts`)
- ✅ `availableTools` inclui schemas completos
- ✅ Exemplos e hints disponíveis para planners

#### **4. Planner Enhancement** (`react-planner.ts`)
- ✅ `buildEnhancedToolsContext()` mostra schemas detalhados
- ✅ Prompt inclui parâmetros obrigatórios/opcionais
- ✅ Exemplos de uso e hints contextuais

### **Benefícios Alcançados:**
- 🧠 **Planners têm contexto completo** para preencher parâmetros
- 📋 **Schemas detalhados** com tipos e required flags
- 🎯 **Context engineering** com exemplos e hints
- ✅ **Type safety** mantido em toda cadeia

---

## 🚀 **PRÓXIMOS PASSOS PLANEJADOS**

### **1. Parameter Extraction Logic** (Próximo)
Sistema para extrair automaticamente parâmetros do input do usuário:

```typescript
// Input: "busque notícias de IA do último mês"
// Extrai automaticamente:
{
  query: "IA",
  filters: {
    category: "tech",        // Inferido de "IA"
    dateRange: {
      start: "2024-12-16",   // "último mês" parseado
      end: "2025-01-16"
    }
  },
  limit: 10                  // Default inteligente
}
```

**Componentes:**
- **Date Parser**: "último mês" → dateRange estruturado
- **Category Mapper**: "tecnologia" → "tech"
- **Context Extractor**: Usa histórico da conversa
- **Smart Defaults**: Valores padrão inteligentes

### **2. Teste End-to-End**
- Criar tool complexa com múltiplos parâmetros obrigatórios
- Validar fluxo: Input → Planner → Tool Selection → Execution

### **3. Atualizar Outros Planners**
- Tree of Thoughts (ToT)
- Reflexion
- Plan-Execute

### **4. Tool Composition**
- Pipeline de tools
- Dependências entre tools
- Execução condicional

---

## 📝 **HISTÓRICO COMPLETO:**

1. ✅ Identificado problema de infinite loop com tools
2. ✅ Corrigido threadId consistency issues
3. ✅ Revisado segurança do contextManager
4. ✅ Diagnosticado problema core: falta de contexto para planners
5. ✅ Implementado Tool Metadata Enhancement
6. ✅ Implementado Planner Context Engineering
7. 📋 Planejado Parameter Extraction Logic

---

## 🔒 **ESTADO ATUAL DO SISTEMA:**

- **Compilação**: ✅ Build passando
- **Tool Metadata**: ✅ Implementado e funcionando
- **Planner Context**: ✅ ReAct atualizado com schemas
- **Próximo Foco**: Parameter Extraction Logic

**IMPORTANTE**: Sistema pronto para usar metadados completos das tools. Planners agora recebem schemas detalhados com parâmetros obrigatórios.

---

## 🔧 **COMANDOS ÚTEIS:**

```bash
# Build
npm run build

# Testes
npm test

# Lint
npm run lint

# Type check
npm run typecheck
```

**LEMBRETE**: Sou copiloto técnico sênior. Devo contribuir ativamente com expertise e implementações.