import { Injectable } from '@nestjs/common';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    IFileReference,
    ILoadedFileReference,
    IExternalPromptContext,
    PromptSourceType,
} from '@/core/domain/prompts/interfaces/promptExternalReference.interface';
import { PromptExternalReferenceEntity } from '@/core/domain/prompts/entities/promptExternalReference.entity';
import { createHash } from 'crypto';
import {
    IPromptContextLoaderService,
    LoadContextParams,
} from '@/core/domain/prompts/contracts/promptContextLoader.contract';

@Injectable()
export class PromptContextLoaderService implements IPromptContextLoaderService {
    constructor(
        private readonly codeManagementService: CodeManagementService,
        private readonly logger: PinoLoggerService,
    ) {}

    async loadExternalContext(
        params: LoadContextParams,
    ): Promise<IExternalPromptContext> {
        const fileContentCache = new Map<string, string>();
        const updatedReferences: Array<{
            entity: PromptExternalReferenceEntity;
            updated: boolean;
        }> = [];
        const successfullyLoadedFiles = new Set<string>();

        for (const refDoc of params.allReferences) {
            let hasUpdates = false;

            for (const ref of refDoc.references) {
                const cacheKey = `${ref.repositoryName || params.repository.id}:${ref.filePath}`;

                if (fileContentCache.has(cacheKey)) {
                    continue;
                }

                try {
                    const content = await this.loadFileContent(
                        ref,
                        params.repository,
                        params.pullRequest,
                        params.organizationAndTeamData,
                    );

                    fileContentCache.set(cacheKey, content);
                    successfullyLoadedFiles.add(ref.filePath);
                } catch (error) {
                    this.logger.warn({
                        message: 'Failed to load external reference',
                        context: PromptContextLoaderService.name,
                        metadata: {
                            filePath: ref.filePath,
                            repositoryName: ref.repositoryName,
                            error: error.message,
                            prNumber: params.pullRequest.number,
                            organizationAndTeamData:
                                params.organizationAndTeamData,
                        },
                    });
                }
            }

            if (refDoc.syncErrors && successfullyLoadedFiles.size > 0) {
                const beforeCleanup = refDoc.syncErrors.length;
                const cleanedErrors = refDoc.syncErrors.filter(
                    (syncError) =>
                        !successfullyLoadedFiles.has(
                            syncError.details?.fileName || '',
                        ),
                );
                const afterCleanup = cleanedErrors.length;

                if (beforeCleanup > afterCleanup) {
                    hasUpdates = true;
                    this.logger.log({
                        message:
                            'Cleaned syncErrors for successfully loaded files',
                        context: PromptContextLoaderService.name,
                        metadata: {
                            removedErrorsCount: beforeCleanup - afterCleanup,
                            remainingErrorsCount: afterCleanup,
                            successfulFiles: Array.from(
                                successfullyLoadedFiles,
                            ),
                            organizationAndTeamData:
                                params.organizationAndTeamData,
                        },
                    });
                }
            }

            if (hasUpdates) {
                updatedReferences.push({ entity: refDoc, updated: true });
            }
        }

        if (updatedReferences.length > 0) {
            this.logger.log({
                message: 'External references loaded with updates',
                context: PromptContextLoaderService.name,
                metadata: {
                    totalReferences: params.allReferences.length,
                    updatedCount: updatedReferences.length,
                    successfullyLoadedFilesCount: successfullyLoadedFiles.size,
                    prNumber: params.pullRequest.number,
                    organizationAndTeamData: params.organizationAndTeamData,
                },
            });
        }

        return this.buildContextMap(params.allReferences, fileContentCache);
    }

    private async loadFileContent(
        ref: IFileReference,
        repository: { id: string; name: string },
        pullRequest: {
            head?: { sha: string };
            number: number;
            [key: string]: any;
        },
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<string> {
        const fullContent =
            await this.codeManagementService.getRepositoryContentFile({
                organizationAndTeamData,
                repository: {
                    id: repository.id,
                    name: ref.repositoryName || repository.name,
                },
                file: { filename: ref.filePath },
                pullRequest: pullRequest as any,
            });

        let content = fullContent?.data?.content;
        if (fullContent?.data?.encoding === 'base64') {
            content = Buffer.from(content, 'base64').toString('utf-8');
        }

        if (ref.lineRange) {
            const extractedContent = this.extractLineRange(
                content,
                ref.lineRange,
                organizationAndTeamData,
            );

            // Fallback: Se o range retornou vazio, usa o arquivo completo
            if (!extractedContent || extractedContent.trim().length === 0) {
                this.logger.warn({
                    message:
                        'Line range extraction returned empty content, falling back to full file',
                    context: PromptContextLoaderService.name,
                    metadata: {
                        filePath: ref.filePath,
                        requestedRange: ref.lineRange,
                        totalLines: content.split('\n').length,
                        organizationAndTeamData: organizationAndTeamData,
                    },
                });
                // Mantém conteúdo completo como fallback
            } else {
                content = extractedContent;
            }
        }

        // Calculate content hash for tracking (would need repository.update() to persist)
        const contentHash = this.calculateContentHash(content);
        const tokenCount = this.estimateTokens(content);

        // Clear error if file was successfully loaded
        if (ref.lastFetchError) {
            this.logger.log({
                message:
                    'File loaded successfully despite previous fetch error',
                context: PromptContextLoaderService.name,
                metadata: {
                    filePath: ref.filePath,
                    previousError: ref.lastFetchError.message,
                    organizationAndTeamData: organizationAndTeamData,
                },
            });
            // Note: Cannot modify entity directly - would need repository.update() to persist
        }

        if (tokenCount > 10000) {
            throw new Error(
                `File too large: ${tokenCount} tokens (max: 10000). ` +
                    `Use line ranges (@file:${ref.filePath}#L10-L50) to include only relevant sections.`,
            );
        }

        this.logger.log({
            message: 'File content loaded and hash calculated',
            context: PromptContextLoaderService.name,
            metadata: {
                filePath: ref.filePath,
                contentHash,
                tokens: tokenCount,
                hasLineRange: !!ref.lineRange,
                organizationAndTeamData: organizationAndTeamData,
            },
        });

        return content;
    }

    private extractLineRange(
        content: string,
        range: { start: number; end: number },
        organizationAndTeamData: OrganizationAndTeamData,
    ): string {
        const lines = content.split('\n');

        // Validação: range válido?
        if (range.start <= 0 || range.end <= 0 || range.start > range.end) {
            this.logger.warn({
                message: 'Invalid line range provided',
                context: PromptContextLoaderService.name,
                metadata: {
                    range,
                    organizationAndTeamData: organizationAndTeamData,
                },
            });
            return ''; // Retorna vazio para acionar fallback
        }

        // Validação: range fora do arquivo?
        if (range.start > lines.length) {
            this.logger.warn({
                message: 'Line range start exceeds file length',
                context: PromptContextLoaderService.name,
                metadata: {
                    range,
                    totalLines: lines.length,
                    organizationAndTeamData: organizationAndTeamData,
                },
            });
            return ''; // Retorna vazio para acionar fallback
        }

        const start = Math.max(0, range.start - 1);
        const end = Math.min(lines.length, range.end);
        return lines.slice(start, end).join('\n');
    }

    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    private calculateContentHash(content: string): string {
        return createHash('sha256').update(content).digest('hex');
    }

    private buildContextMap(
        allReferences: PromptExternalReferenceEntity[],
        fileContentCache: Map<string, string>,
    ): IExternalPromptContext {
        const context: IExternalPromptContext = {
            categories: {},
            severity: {},
            generation: {},
        };

        for (const refDoc of allReferences) {
            const loadedReferences: ILoadedFileReference[] = refDoc.references
                .map((ref) => {
                    const cacheKey = `${ref.repositoryName || refDoc.repositoryId}:${ref.filePath}`;
                    const content = fileContentCache.get(cacheKey);

                    if (!content) {
                        return null;
                    }

                    return {
                        ...ref,
                        content,
                    };
                })
                .filter((ref): ref is ILoadedFileReference => ref !== null);

            const errorMessage =
                refDoc.syncErrors && refDoc.syncErrors.length > 0
                    ? refDoc.syncErrors.map((e) => e.message).join('; ')
                    : undefined;

            switch (refDoc.sourceType) {
                case PromptSourceType.CUSTOM_INSTRUCTION:
                    context.customInstructions = {
                        references: loadedReferences,
                        error: errorMessage,
                    };
                    break;

                case PromptSourceType.CATEGORY_BUG:
                    context.categories.bug = {
                        references: loadedReferences,
                        error: errorMessage,
                    };
                    break;

                case PromptSourceType.CATEGORY_PERFORMANCE:
                    context.categories.performance = {
                        references: loadedReferences,
                        error: errorMessage,
                    };
                    break;

                case PromptSourceType.CATEGORY_SECURITY:
                    context.categories.security = {
                        references: loadedReferences,
                        error: errorMessage,
                    };
                    break;

                case PromptSourceType.SEVERITY_CRITICAL:
                    if (!context.severity) context.severity = {};
                    context.severity.critical = {
                        references: loadedReferences,
                        error: errorMessage,
                    };
                    break;

                case PromptSourceType.SEVERITY_HIGH:
                    if (!context.severity) context.severity = {};
                    context.severity.high = {
                        references: loadedReferences,
                        error: errorMessage,
                    };
                    break;

                case PromptSourceType.SEVERITY_MEDIUM:
                    if (!context.severity) context.severity = {};
                    context.severity.medium = {
                        references: loadedReferences,
                        error: errorMessage,
                    };
                    break;

                case PromptSourceType.SEVERITY_LOW:
                    if (!context.severity) context.severity = {};
                    context.severity.low = {
                        references: loadedReferences,
                        error: errorMessage,
                    };
                    break;

                case PromptSourceType.GENERATION_MAIN:
                    context.generation = {
                        main: {
                            references: loadedReferences,
                            error: errorMessage,
                        },
                    };
                    break;
            }
        }

        return context;
    }

    injectContextIntoPrompt(
        promptText: string,
        references: ILoadedFileReference[],
    ): string {
        if (!references || references.length === 0) {
            return promptText;
        }

        const contextSection = references
            .map((ref) => {
                const header = ref.lineRange
                    ? `\n\n--- Content from ${ref.filePath} (lines ${ref.lineRange.start}-${ref.lineRange.end}) ---\n`
                    : `\n\n--- Content from ${ref.filePath} ---\n`;

                return `${header}${ref.content}\n--- End of ${ref.filePath} ---`;
            })
            .join('\n');

        return `${promptText}\n\n## External Context\n${contextSection}`;
    }

    enrichPromptWithContext(
        originalPrompt: string,
        externalContext: IExternalPromptContext,
        sourceType:
            | 'customInstructions'
            | 'category'
            | 'severity'
            | 'generation',
        subType?: string,
    ): string {
        if (!externalContext || !originalPrompt) {
            return originalPrompt;
        }

        let references: ILoadedFileReference[] = [];

        switch (sourceType) {
            case 'customInstructions':
                references =
                    externalContext.customInstructions?.references || [];
                break;
            case 'category':
                if (subType && externalContext.categories?.[subType]) {
                    references =
                        externalContext.categories[subType].references || [];
                }
                break;
            case 'severity':
                if (subType && externalContext.severity?.[subType]) {
                    references =
                        externalContext.severity[subType].references || [];
                }
                break;
            case 'generation':
                if (subType === 'main' && externalContext.generation?.main) {
                    references =
                        externalContext.generation.main.references || [];
                }
                break;
        }

        return this.injectContextIntoPrompt(originalPrompt, references);
    }
}
