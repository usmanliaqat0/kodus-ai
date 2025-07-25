import { Injectable, Inject } from '@nestjs/common';
import {
    IRuleFileParseResult,
    IParsedRuleContent,
} from '@/core/domain/kodyRules/interfaces/ruleFileSync.interface';
import { LLMModelProvider } from '@/core/infrastructure/adapters/services/llmProviders/llmModelProvider.helper';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import {
    prompt_RuleFileExtractionSystem,
    prompt_RuleFileExtractionUser,
    prompt_RuleFileNormalizationSystem,
    prompt_RuleFileNormalizationUser,
} from '@/shared/utils/langchainCommon/prompts/ruleFileExtraction';
import { LLM_PROVIDER_SERVICE_TOKEN } from '@/core/infrastructure/adapters/services/llmProviders/llmProvider.service.contract';
import { KodyRulesScope } from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import { KodyRuleSeverity } from '@/core/infrastructure/http/dtos/create-kody-rule.dto';
import { RunnableSequence } from '@langchain/core/runnables';
import { CustomStringOutputParser } from '@/shared/utils/langchainCommon/customStringOutputParser';
import { LLMProviderService } from '@/core/infrastructure/adapters/services/llmProviders/llmProvider.service';

/**
 * Service that uses LLM to extract coding rules from repository files
 *
 * This service uses intelligent LLM analysis to understand context, intent,
 * and extract meaningful rules from various file formats (.cursorrules,
 * CLAUDE.md, README.md, coding-standards.md, etc.)
 *
 * The LLM approach provides flexibility to handle any file format without
 * needing specific parsers, while maintaining high-quality rule extraction.
 */
@Injectable()
export class LLMRuleExtractionService {
    constructor(
        @Inject(LLM_PROVIDER_SERVICE_TOKEN)
        private readonly llmProviderService: LLMProviderService,
        private readonly logger: PinoLoggerService,
    ) {}

    /**
     * Extract rules from a repository file using LLM
     */
    async extractRulesFromFile(
        filePath: string,
        fileContent: string,
        repositoryContext?: {
            language?: string;
            framework?: string;
            name?: string;
        },
    ): Promise<IRuleFileParseResult> {
        const startTime = Date.now();

        this.logger.log({
            message: 'Starting LLM-based rule extraction',
            context: LLMRuleExtractionService.name,
            metadata: {
                filePath,
                contentLength: fileContent.length,
                repositoryContext,
            },
        });

        try {
            // Step 1: Extract rules using LLM
            const extractedRules = await this.extractRawRules(
                filePath,
                fileContent,
                repositoryContext,
            );

            if (!extractedRules || extractedRules.length === 0) {
                this.logger.debug({
                    message: 'No rules extracted from file',
                    context: LLMRuleExtractionService.name,
                    metadata: { filePath },
                });

                return {
                    filePath,
                    success: true,
                    rules: [],
                    metadata: {
                        fileType: 'llm-extracted',
                        language: repositoryContext?.language,
                        parsingDuration: Date.now() - startTime,
                    },
                };
            }

            // Step 2: Normalize and deduplicate rules
            const normalizedRules = await this.normalizeAndDeduplicateRules(
                extractedRules,
                repositoryContext,
            );

            // Step 3: Convert to IParsedRuleContent format
            const parsedRules = normalizedRules.map((rule) =>
                this.convertToIParsedRuleContent(rule),
            );

            this.logger.log({
                message: 'LLM rule extraction completed',
                context: LLMRuleExtractionService.name,
                metadata: {
                    filePath,
                    extractedCount: extractedRules.length,
                    normalizedCount: normalizedRules.length,
                    finalCount: parsedRules.length,
                    duration: Date.now() - startTime,
                },
            });

            return {
                filePath,
                success: true,
                rules: parsedRules,
                metadata: {
                    fileType: 'llm-extracted',
                    language: repositoryContext?.language,
                    parsingDuration: Date.now() - startTime,
                },
            };
        } catch (error) {
            const errorMessage = `LLM rule extraction failed: ${error.message}`;

            this.logger.error({
                message: errorMessage,
                context: LLMRuleExtractionService.name,
                error,
                metadata: { filePath, repositoryContext },
            });

            return {
                filePath,
                success: false,
                rules: [],
                errors: [errorMessage],
                metadata: {
                    fileType: 'llm-extracted',
                    language: repositoryContext?.language,
                    parsingDuration: Date.now() - startTime,
                },
            };
        }
    }

    /**
     * Extract rules from multiple files and merge them intelligently
     */
    async extractRulesFromMultipleFiles(
        files: Array<{
            path: string;
            content: string;
        }>,
        repositoryContext?: {
            language?: string;
            framework?: string;
            name?: string;
        },
    ): Promise<{
        individualResults: IRuleFileParseResult[];
        consolidatedRules: IParsedRuleContent[];
        deduplicationSummary: {
            originalCount: number;
            deduplicatedCount: number;
            removedDuplicates: number;
        };
    }> {
        this.logger.log({
            message: 'Starting multi-file LLM rule extraction',
            context: LLMRuleExtractionService.name,
            metadata: {
                fileCount: files.length,
                repositoryContext,
            },
        });

        // 1️⃣ Extraction: Process each file individually in parallel
        const individualResults = await Promise.all(
            files.map((file) =>
                this.extractRulesFromFile(
                    file.path,
                    file.content,
                    repositoryContext,
                ),
            ),
        );

        // 2️⃣ Consolidation: Collect all rules from successful extractions
        const allExtractedRules = individualResults
            .filter((result) => result.success)
            .flatMap((result) => result.rules);

        const originalCount = allExtractedRules.length;

        // 3️⃣ Global Deduplication: Apply global deduplication if we have multiple rules
        let consolidatedRules = allExtractedRules;
        if (allExtractedRules.length > 1) {
            consolidatedRules = await this.performGlobalDeduplication(
                allExtractedRules,
                repositoryContext,
            );
        }

        const deduplicationSummary = {
            originalCount,
            deduplicatedCount: consolidatedRules.length,
            removedDuplicates: originalCount - consolidatedRules.length,
        };

        this.logger.log({
            message: 'Multi-file rule extraction completed',
            context: LLMRuleExtractionService.name,
            metadata: {
                fileCount: files.length,
                ...deduplicationSummary,
            },
        });

        return {
            individualResults,
            consolidatedRules,
            deduplicationSummary,
        };
    }

    /**
     * Extract raw rules using LLM
     */
    private async extractRawRules(
        filePath: string,
        fileContent: string,
        repositoryContext?: {
            language?: string;
            framework?: string;
            name?: string;
        },
    ): Promise<any[]> {
        const payload = {
            filePath,
            fileContent,
            repositoryContext,
        };

        try {
            const chain = await this.createExtractionChainWithFallback(
                LLMModelProvider.GEMINI_2_5_FLASH,
                LLMModelProvider.GEMINI_2_5_PRO,
                prompt_RuleFileExtractionSystem,
                prompt_RuleFileExtractionUser,
                'ruleFileExtraction',
            );

            const result = await chain.invoke(payload);
            const parsedResult = this.processLLMResponse(result);

            return parsedResult || [];
        } catch (error) {
            this.logger.error({
                message: 'Failed to extract raw rules with LLM',
                context: LLMRuleExtractionService.name,
                error,
                metadata: { filePath },
            });
            return [];
        }
    }

    /**
     * Normalize and deduplicate rules using LLM
     */
    private async normalizeAndDeduplicateRules(
        extractedRules: any[],
        repositoryContext?: {
            language?: string;
            framework?: string;
        },
    ): Promise<any[]> {
        if (!extractedRules || extractedRules.length === 0) {
            return [];
        }

        // If only one rule, no need for deduplication
        if (extractedRules.length === 1) {
            return extractedRules;
        }

        const payload = {
            extractedRules,
            repositoryContext,
        };

        try {
            const chain = await this.createExtractionChainWithFallback(
                LLMModelProvider.GEMINI_2_5_PRO,
                LLMModelProvider.VERTEX_CLAUDE_3_5_SONNET,
                prompt_RuleFileNormalizationSystem,
                prompt_RuleFileNormalizationUser,
                'ruleFileNormalization',
            );

            const result = await chain.invoke(payload);
            const parsedResult = this.processLLMResponse(result);

            return parsedResult || extractedRules;
        } catch (error) {
            this.logger.warn({
                message: 'Failed to normalize rules with LLM, using raw rules',
                context: LLMRuleExtractionService.name,
                error,
            });
            return extractedRules;
        }
    }

    /**
     * Convert LLM output to IParsedRuleContent format
     */
    private convertToIParsedRuleContent(rule: any): IParsedRuleContent {
        return {
            title: rule.title || 'Untitled Rule',
            rule: rule.rule || rule.description || '',
            severity: this.mapSeverity(rule.severity),
            scope: this.mapScope(rule.scope),
            path: rule.path,
            examples: rule.examples || [],
            metadata: {
                language: rule.metadata?.language,
                framework: rule.metadata?.framework,
                category: rule.metadata?.category || 'general',
            },
        };
    }

    /**
     * Map LLM severity to KodyRuleSeverity
     */
    private mapSeverity(severity: string): KodyRuleSeverity {
        switch (severity?.toLowerCase()) {
            case 'critical':
            case 'high':
            case 'medium':
            case 'low':
            default:
                return KodyRuleSeverity.LOW;
        }
    }

    /**
     * Map LLM scope to KodyRulesScope
     */
    private mapScope(scope: string): KodyRulesScope {
        switch (scope?.toLowerCase()) {
            case 'pull_request':
            case 'pr':
            case 'pullrequest':
                return KodyRulesScope.PULL_REQUEST;
            case 'file':
            default:
                return KodyRulesScope.FILE;
        }
    }

    /**
     * Perform global deduplication across all extracted rules
     */
    private async performGlobalDeduplication(
        allRules: IParsedRuleContent[],
        repositoryContext?: {
            language?: string;
            framework?: string;
        },
    ): Promise<IParsedRuleContent[]> {
        if (allRules.length <= 1) {
            return allRules;
        }

        try {
            // Convert IParsedRuleContent back to raw format for LLM processing
            const rawRules = allRules.map((rule) => ({
                title: rule.title,
                rule: rule.rule,
                severity: rule.severity,
                scope: rule.scope,
                path: rule.path,
                examples: rule.examples,
                metadata: rule.metadata,
            }));

            // Use LLM to deduplicate across all rules
            const deduplicatedRawRules =
                await this.normalizeAndDeduplicateRules(
                    rawRules,
                    repositoryContext,
                );

            // Convert back to IParsedRuleContent format
            const deduplicatedRules = deduplicatedRawRules.map((rule) =>
                this.convertToIParsedRuleContent(rule),
            );

            this.logger.log({
                message: 'Global deduplication completed',
                context: LLMRuleExtractionService.name,
                metadata: {
                    originalRulesCount: allRules.length,
                    deduplicatedRulesCount: deduplicatedRules.length,
                    removedDuplicates:
                        allRules.length - deduplicatedRules.length,
                },
            });

            return deduplicatedRules;
        } catch (error) {
            this.logger.warn({
                message: 'Global deduplication failed, keeping original rules',
                context: LLMRuleExtractionService.name,
                error,
            });
            return allRules;
        }
    }

    /**
     * Create LLM chain with fallback (similar to KodyRulesAnalysisService pattern)
     */
    private async createExtractionChainWithFallback(
        provider: LLMModelProvider,
        fallbackProvider: LLMModelProvider,
        systemPromptFn: any,
        userPromptFn: any,
        runName?: string,
    ) {
        try {
            const mainChain = await this.createProviderChain(
                provider,
                systemPromptFn,
                userPromptFn,
                'primary',
            );
            const fallbackChain = await this.createProviderChain(
                fallbackProvider,
                systemPromptFn,
                userPromptFn,
                'fallback',
            );

            return mainChain
                .withFallbacks({
                    fallbacks: [fallbackChain],
                })
                .withConfig({
                    runName,
                    metadata: {
                        provider: provider,
                        fallbackProvider: fallbackProvider,
                    },
                });
        } catch (error) {
            this.logger.error({
                message: 'Error creating extraction chain with fallback',
                error,
                context: LLMRuleExtractionService.name,
                metadata: { provider, fallbackProvider },
            });
            throw error;
        }
    }

    /**
     * Create provider chain (similar to KodyRulesAnalysisService pattern)
     */
    private async createProviderChain(
        provider: LLMModelProvider,
        systemPromptFn: any,
        userPromptFn: any,
        tier: 'primary' | 'fallback',
    ) {
        try {
            let llm = this.llmProviderService.getLLMProvider({
                model: provider,
                temperature: 0,
                jsonMode: true,
            });

            // Create the chain using the correct provider
            const chain = RunnableSequence.from([
                async (input: any) => {
                    const systemPrompt = systemPromptFn();
                    const humanPrompt = userPromptFn(input);

                    return [
                        {
                            role: 'system',
                            content: [
                                {
                                    type: 'text',
                                    text: systemPrompt,
                                },
                            ],
                        },
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: humanPrompt,
                                },
                            ],
                        },
                    ];
                },
                llm,
                new CustomStringOutputParser(),
            ]).withConfig({
                metadata: { provider },
            });

            return chain;
        } catch (error) {
            this.logger.error({
                message: 'Error creating provider chain',
                error,
                context: LLMRuleExtractionService.name,
                metadata: { provider },
            });
            throw error;
        }
    }

    /**
     * Process LLM response (parse JSON)
     */
    private processLLMResponse(response: string): any[] {
        try {
            if (!response || typeof response !== 'string') {
                return [];
            }

            // Try to parse JSON response
            const parsed = JSON.parse(response);

            // Ensure it's an array
            if (Array.isArray(parsed)) {
                return parsed;
            } else if (parsed && typeof parsed === 'object') {
                // If it's an object, check if it has a rules array or similar
                if (parsed.rules && Array.isArray(parsed.rules)) {
                    return parsed.rules;
                }
                // If it's a single rule object, wrap in array
                return [parsed];
            }

            return [];
        } catch (error) {
            this.logger.warn({
                message: 'Failed to parse LLM response as JSON',
                context: LLMRuleExtractionService.name,
                error,
                metadata: { response: response?.substring(0, 200) },
            });
            return [];
        }
    }
}
