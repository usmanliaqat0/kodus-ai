import { Inject, Injectable } from '@nestjs/common';
import { IKodyRule } from '@/core/domain/kodyRules/interfaces/kodyRules.interface';
import { AnalysisContext } from '@/config/types/general/codeReview.type';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import {
    CONTEXT_REFERENCE_SERVICE_TOKEN,
    IContextReferenceService,
} from '@/core/domain/contextReferences/contracts/context-reference.service.contract';

export interface LoadedReference {
    filePath: string;
    content: string;
    description?: string;
}

@Injectable()
export class ExternalReferenceLoaderService {
    constructor(
        private readonly codeManagementService: CodeManagementService,
        private readonly logger: PinoLoggerService,
        @Inject(CONTEXT_REFERENCE_SERVICE_TOKEN)
        private readonly contextReferenceService: IContextReferenceService,
    ) {}

    async loadReferences(
        rule: IKodyRule,
        context: AnalysisContext,
    ): Promise<LoadedReference[]> {
        // Load from context-references (Context OS)
        if (rule.contextReferenceId) {
            try {
                return await this.loadFromContextReference(rule, context);
            } catch (error) {
                this.logger.warn({
                    message: 'Failed to load from context-references',
                    context: ExternalReferenceLoaderService.name,
                    error,
                    metadata: {
                        ruleUuid: rule.uuid,
                        contextReferenceId: rule.contextReferenceId,
                    },
                });
                return [];
            }
        }

        // No contextReferenceId - nothing to load
        this.logger.debug({
            message:
                'Rule has no contextReferenceId, skipping reference loading',
            context: ExternalReferenceLoaderService.name,
            metadata: {
                ruleUuid: rule.uuid,
            },
        });
        return [];
    }

    private async loadFromContextReference(
        rule: IKodyRule,
        context: AnalysisContext,
    ): Promise<LoadedReference[]> {
        const contextRef = await this.contextReferenceService.findById(
            rule.contextReferenceId!,
        );

        if (!contextRef?.requirements?.[0]?.dependencies) {
            return [];
        }

        const loadedReferences: LoadedReference[] = [];

        // Load KNOWLEDGE dependencies (files)
        const knowledgeDeps = contextRef.requirements[0].dependencies.filter(
            (dep) => dep.type === 'knowledge',
        );

        for (const dep of knowledgeDeps) {
            const filePath = dep.metadata?.filePath as string;
            const lineRange = dep.metadata?.lineRange as
                | { start: number; end: number }
                | undefined;
            const description = dep.metadata?.description as string | undefined;

            if (!filePath) continue;

            const content = await this.fetchFileContent(
                filePath,
                lineRange,
                context,
            );
            if (content) {
                loadedReferences.push({
                    filePath,
                    content,
                    description,
                });

                this.logger.log({
                    message: 'Successfully loaded reference from Context OS',
                    context: ExternalReferenceLoaderService.name,
                    metadata: {
                        filePath,
                        ruleUuid: rule.uuid,
                        contentLength: content.length,
                        hasLineRange: !!lineRange,
                    },
                });
            }
        }

        return loadedReferences;
    }

    private async loadFromLegacyReferences(
        rule: IKodyRule,
        context: AnalysisContext,
    ): Promise<LoadedReference[]> {
        // Legacy loading removed - externalReferences field no longer exists
        return [];
    }

    private async fetchFileContent(
        filePath: string,
        lineRange: { start: number; end: number } | undefined,
        context: AnalysisContext,
    ): Promise<string | null> {
        try {
            const fileContent =
                await this.codeManagementService.getRepositoryContentFile({
                    organizationAndTeamData: context.organizationAndTeamData,
                    repository: {
                        id: context.repository.id || '',
                        name: context.repository.name || '',
                    },
                    file: { filename: filePath },
                    pullRequest: context.pullRequest,
                });

            if (!fileContent?.data?.content) {
                return null;
            }

            let content = fileContent.data.content;

            if (fileContent.data.encoding === 'base64') {
                content = Buffer.from(content, 'base64').toString('utf-8');
            }

            if (lineRange) {
                const extractedContent = this.extractLineRange(
                    content,
                    lineRange,
                );

                if (!extractedContent || extractedContent.trim().length === 0) {
                    this.logger.warn({
                        message:
                            'Line range extraction returned empty content, falling back to full file',
                        context: ExternalReferenceLoaderService.name,
                        metadata: {
                            filePath,
                            requestedRange: lineRange,
                            totalLines: content.split('\n').length,
                        },
                    });
                    // Fallback: use full file
                } else {
                    content = extractedContent;
                }
            }

            return content;
        } catch (error) {
            this.logger.error({
                message: 'Failed to fetch file content',
                context: ExternalReferenceLoaderService.name,
                error,
                metadata: {
                    filePath,
                    repository: context.repository?.name,
                },
            });
            return null;
        }
    }

    private extractLineRange(
        content: string,
        range: { start: number; end: number },
    ): string {
        const lines = content.split('\n');

        // Validação: range válido?
        if (range.start <= 0 || range.end <= 0 || range.start > range.end) {
            this.logger.warn({
                message: 'Invalid line range provided',
                context: ExternalReferenceLoaderService.name,
                metadata: { range },
            });
            return ''; // Retorna vazio para acionar fallback
        }

        // Validação: range fora do arquivo?
        if (range.start > lines.length) {
            this.logger.warn({
                message: 'Line range start exceeds file length',
                context: ExternalReferenceLoaderService.name,
                metadata: {
                    range,
                    totalLines: lines.length,
                },
            });
            return ''; // Retorna vazio para acionar fallback
        }

        const start = Math.max(0, range.start - 1);
        const end = Math.min(lines.length, range.end);
        return lines.slice(start, end).join('\n');
    }

    async loadReferencesForRules(
        rules: Partial<IKodyRule>[],
        context: AnalysisContext,
    ): Promise<Map<string, LoadedReference[]>> {
        const referencesMap = new Map<string, LoadedReference[]>();

        for (const rule of rules) {
            if (rule.uuid) {
                const loadedRefs = await this.loadReferences(
                    rule as IKodyRule,
                    context,
                );
                if (loadedRefs.length > 0) {
                    referencesMap.set(rule.uuid, loadedRefs);
                }
            }
        }

        const totalLoaded = Array.from(referencesMap.values()).reduce(
            (sum, refs) => sum + refs.length,
            0,
        );

        this.logger.log({
            message: 'Loaded external references for rules',
            context: ExternalReferenceLoaderService.name,
            metadata: {
                totalRules: rules.length,
                rulesWithReferences: referencesMap.size,
                totalReferencesLoaded: totalLoaded,
                organizationAndTeamData: context.organizationAndTeamData,
            },
        });

        return referencesMap;
    }
}
