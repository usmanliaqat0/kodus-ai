import {
    KODY_RULES_SERVICE_TOKEN,
    IKodyRulesService,
} from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import {
    CONTEXT_REFERENCE_SERVICE_TOKEN,
    IContextReferenceService,
} from '@/core/domain/contextReferences/contracts/context-reference.service.contract';

@Injectable()
export class FindByOrganizationIdKodyRulesUseCase {
    constructor(
        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string } };
        },

        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        @Inject(CONTEXT_REFERENCE_SERVICE_TOKEN)
        private readonly contextReferenceService: IContextReferenceService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute() {
        try {
            if (!this.request.user.organization.uuid) {
                throw new Error('Organization ID not found');
            }

            const existing = await this.kodyRulesService.findByOrganizationId(
                this.request.user.organization.uuid,
            );

            if (!existing) {
                throw new NotFoundException(
                    'No Kody rules found for the given organization ID',
                );
            }

            // Enriquecer com informações de referências do Context OS
            const enrichedRules =
                await this.enrichRulesWithContextReferences(existing);

            return enrichedRules;
        } catch (error) {
            this.logger.error({
                message: 'Error finding Kody Rules by organization ID',
                context: FindByOrganizationIdKodyRulesUseCase.name,
                error: error,
                metadata: {
                    organizationId: this.request.user.organization.uuid,
                },
            });
            throw error;
        }
    }

    /**
     * Enriquece as kodyRules com informações de referências do Context OS
     */
    private async enrichRulesWithContextReferences(
        kodyRules: any,
    ): Promise<any> {
        const enrichedRules = await Promise.all(
            (kodyRules.rules || []).map(async (rule: any) => {
                if (!rule.contextReferenceId) {
                    return {
                        ...rule,
                        referenceProcessingStatus: null,
                        externalReferences: [],
                        syncErrors: [],
                    };
                }

                try {
                    const contextRef =
                        await this.contextReferenceService.findById(
                            rule.contextReferenceId,
                        );

                    if (!contextRef) {
                        return {
                            ...rule,
                            referenceProcessingStatus: 'pending',
                            externalReferences: [],
                            syncErrors: [],
                        };
                    }

                    // Extrair referencias de knowledge dos requirements
                    const externalReferences =
                        this.extractExternalReferences(contextRef);
                    const syncErrors = this.extractSyncErrors(contextRef);

                    return {
                        ...rule,
                        referenceProcessingStatus: contextRef.processingStatus,
                        lastReferenceProcessedAt: contextRef.lastProcessedAt,
                        externalReferences,
                        syncErrors,
                    };
                } catch (error) {
                    this.logger.warn({
                        message: 'Failed to fetch context reference for rule',
                        context: FindByOrganizationIdKodyRulesUseCase.name,
                        error,
                        metadata: {
                            ruleId: rule.uuid,
                            contextReferenceId: rule.contextReferenceId,
                        },
                    });

                    return {
                        ...rule,
                        referenceProcessingStatus: 'failed',
                        externalReferences: [],
                        syncErrors: [],
                    };
                }
            }),
        );

        return {
            ...kodyRules,
            rules: enrichedRules,
        };
    }

    /**
     * Extrai external references dos requirements (tipo 'knowledge')
     */
    private extractExternalReferences(contextRef: any): any[] {
        const references: any[] = [];
        const requirements = contextRef.requirements || [];

        for (const requirement of requirements) {
            const dependencies = requirement.dependencies || [];

            for (const dep of dependencies) {
                if (dep.type === 'knowledge' && dep.metadata) {
                    references.push({
                        filePath: dep.metadata.filePath,
                        description: dep.metadata.description,
                        originalText: dep.metadata.originalText,
                        repositoryName: dep.metadata.repositoryName,
                        lastValidatedAt: dep.metadata.detectedAt
                            ? new Date(dep.metadata.detectedAt)
                            : undefined,
                    });
                }
            }
        }

        return references;
    }

    /**
     * Extrai sync errors dos requirements metadata
     */
    private extractSyncErrors(contextRef: any): any[] {
        const errors: any[] = [];
        const requirements = contextRef.requirements || [];

        for (const requirement of requirements) {
            const syncErrors = (requirement.metadata as any)?.syncErrors || [];
            errors.push(...syncErrors);
        }

        return errors;
    }
}
