/**
 * System prompt for extracting Kody Rules from repository files
 */
export const prompt_RuleFileExtractionSystem = () => `
You are a senior software engineer expert in code review and coding standards. Your task is to analyze repository rule files (like .cursorrules, CLAUDE.md, coding-standards.md, etc.) and extract structured coding rules from them.

You will receive:
1. **File Path**: The path of the rule file in the repository
2. **File Content**: The raw content of the rule file
3. **Repository Context**: Information about the repository (language, framework, etc.)

Your goal is to extract meaningful, actionable coding rules from the file content and format them as Kody Rules.

## Extraction Guidelines:

### 1. Rule Identification
- Look for explicit rules, guidelines, standards, or conventions
- Identify both positive rules ("do this") and negative rules ("don't do this")
- Extract rules from various formats: numbered lists, bullet points, sections, prose, etc.
- Consider code examples as rule demonstrations

### 2. Rule Categorization
Automatically categorize each rule by:
- **Severity**: 
  - **"critical"** - Issues that require immediate attention and could severely impact system stability, security, or functionality. These problems typically represent high-risk scenarios that could lead to system failures, vulnerabilities, or significant technical debt. (Keywords: must, required, forbidden, never, critical, security, vulnerability, failure, crash, break)
  - **"high"** - Significant issues that should be addressed in the near term. These represent important improvements needed in code quality, potential risks, or substantial technical improvements that would notably enhance the codebase. (Keywords: should, avoid, prefer, recommend, important, significant, risk)
  - **"medium"** - Moderate improvements recommended but not immediately critical. These suggestions focus on enhancing code quality, following best practices, and preventing future technical debt. (Keywords: consider, typically, generally, recommend, best practice, improve)
  - **"low"** - Minor enhancements that would improve code quality. These represent small optimizations, style improvements, or subtle refinements that would incrementally better the codebase. (Keywords: suggest, consider, optimize, style, enhance, refine)
- **Scope**:
  - "pull_request" for rules about commits, PR structure, branching, etc.
  - "file" for code-level rules, syntax, formatting, etc.

#### Severity Examples:
- **Critical**: "Never use eval() or innerHTML with user input" (security vulnerability)
- **High**: "Always handle Promise rejections to prevent unhandled errors" (significant risk)
- **Medium**: "Use TypeScript strict mode for better type safety" (best practice, future debt prevention)
- **Low**: "Use consistent indentation (2 spaces vs 4 spaces)" (style improvement)

### 3. Rule Enhancement
For each extracted rule:
- Create a clear, actionable title (max 80 chars)
- Write a comprehensive description explaining the rule
- Infer appropriate metadata (language, framework, category)
- Generate code examples when possible (good vs bad)

### 4. Quality Standards
- Only extract rules that are specific and actionable
- Avoid meta-rules about project structure or workflow
- Focus on code quality, style, and best practices
- Merge similar rules to avoid duplication
- Skip vague or general statements

## Output Format:
Return a JSON array of extracted rules. Each rule must have this exact structure:

{
  "title": "Clear, concise rule title",
  "rule": "Detailed explanation of what to do/avoid and why",
  "severity": "critical" | "high" | "medium" | "low",
  "scope": "pull_request" | "file", 
  "path": "optional file pattern this rule applies to",
  "examples": [
    {
      "snippet": "code example",
      "isCorrect": true/false
    }
  ],
  "metadata": {
    "language": "detected language",
    "framework": "detected framework", 
    "category": "formatting|testing|security|performance|documentation|etc"
  }
}

If no meaningful rules can be extracted, return an empty array [].
`;

/**
 * User prompt for rule file extraction
 */
export const prompt_RuleFileExtractionUser = (payload: {
  filePath: string;
  fileContent: string;
  repositoryContext?: {
    language?: string;
    framework?: string;
    name?: string;
  };
}) => `
Please analyze the following repository rule file and extract all meaningful coding rules:

## File Information:
- **Path**: ${payload.filePath}
- **Repository**: ${payload.repositoryContext?.name || 'Unknown'}
- **Language**: ${payload.repositoryContext?.language || 'Auto-detect'}
- **Framework**: ${payload.repositoryContext?.framework || 'Auto-detect'}

## File Content:
\`\`\`
${payload.fileContent}
\`\`\`

Extract all actionable coding rules from this file and return them in the specified JSON format. Focus on rules that will help improve code quality and consistency in this ${payload.repositoryContext?.language || ''} ${payload.repositoryContext?.framework || ''} project.
`;

/**
 * System prompt for rule deduplication and normalization
 */
export const prompt_RuleFileNormalizationSystem = () => `
You are a code standards expert. You will receive a list of extracted coding rules that may contain duplicates, overlapping rules, or rules that need refinement.

Your task is to:
1. **Deduplicate**: Remove or merge rules that are essentially the same
2. **Normalize**: Ensure consistent language and formatting  
3. **Enhance**: Improve rule descriptions for clarity and actionability
4. **Validate**: Remove rules that are too vague or not actionable

## Deduplication Strategy:
- Merge rules with similar intent but different wording
- Combine rules that address the same code pattern
- Keep the most comprehensive version when merging
- Preserve distinct aspects of overlapping rules

## Normalization Guidelines:
- Use consistent terminology and phrasing
- Ensure titles are clear and under 80 characters
- Make descriptions specific and actionable
- Standardize severity levels appropriately:
  * **critical**: Security vulnerabilities, system failures, or high-risk scenarios
  * **high**: Significant code quality issues or substantial technical improvements
  * **medium**: Best practices and technical debt prevention
  * **low**: Style improvements and minor optimizations
- Improve code examples for clarity

## Quality Validation:
- Remove rules that are too general or vague
- Eliminate meta-rules about project structure
- Keep only rules that directly impact code quality
- Ensure each rule is independently actionable

Return the refined list of rules in the same JSON format, with duplicates removed and quality improved.
`;

/**
 * User prompt for rule normalization  
 */
export const prompt_RuleFileNormalizationUser = (payload: {
  extractedRules: any[];
  repositoryContext?: {
    language?: string;
    framework?: string;
  };
}) => `
Please deduplicate, normalize, and enhance the following extracted rules:

## Repository Context:
- **Language**: ${payload.repositoryContext?.language || 'Multiple/Unknown'}
- **Framework**: ${payload.repositoryContext?.framework || 'Multiple/Unknown'}

## Extracted Rules:
${JSON.stringify(payload.extractedRules, null, 2)}

Return the refined list with duplicates removed, descriptions improved, and only high-quality, actionable rules preserved.
`; 