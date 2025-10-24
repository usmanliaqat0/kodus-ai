import { Inject, Injectable } from '@nestjs/common';
import {
    IPromptExternalReferenceRepository,
    PROMPT_EXTERNAL_REFERENCE_REPOSITORY_TOKEN,
} from '@/core/domain/prompts/contracts/promptExternalReferenceRepository.contract';
import {
    IPromptContextEngineService,
    PROMPT_CONTEXT_ENGINE_SERVICE_TOKEN,
} from '@/core/domain/prompts/contracts/promptContextEngine.contract';
import { IPromptExternalReferenceManagerService } from '@/core/domain/prompts/contracts/promptExternalReferenceManager.contract';
import { PromptExternalReferenceEntity } from '@/core/domain/prompts/entities/promptExternalReference.entity';
import {
    PromptSourceType,
    IPromptExternalReference,
    PromptProcessingStatus,
} from '@/core/domain/prompts/interfaces/promptExternalReference.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { BYOKConfig } from '@kodus/kodus-common/llm';

@Injectable()
export class PromptExternalReferenceManagerService
    implements IPromptExternalReferenceManagerService
{
    constructor(
        @Inject(PROMPT_EXTERNAL_REFERENCE_REPOSITORY_TOKEN)
        private readonly repository: IPromptExternalReferenceRepository,
        @Inject(PROMPT_CONTEXT_ENGINE_SERVICE_TOKEN)
        private readonly contextEngine: IPromptContextEngineService,
        private readonly logger: PinoLoggerService,
    ) {}

    async processPromptReferences(params: {
        promptText: string;
        configKey: string;
        sourceType: PromptSourceType;
        organizationId: string;
        repositoryId: string;
        repositoryName: string;
        directoryId?: string;
        kodyRuleId?: string;
        organizationAndTeamData: OrganizationAndTeamData;
        context?: 'rule' | 'instruction' | 'prompt';
        byokConfig?: BYOKConfig;
    }): Promise<{
        entity: PromptExternalReferenceEntity | null;
        wasProcessed: boolean;
    }> {
        try {
            const currentHash = this.contextEngine.calculatePromptHash(
                params.promptText,
            );

            const existing = await this.repository.findByConfigKey(
                params.configKey,
                params.sourceType,
            );

            if (existing && existing.promptHash === currentHash) {
                this.logger.log({
                    message: 'Prompt hash unchanged, skipping reprocessing',
                    context: PromptExternalReferenceManagerService.name,
                    metadata: {
                        configKey: params.configKey,
                        sourceType: params.sourceType,
                        promptHash: currentHash,
                    },
                });
                return { entity: existing, wasProcessed: false };
            }

            const { references, syncErrors } =
                await this.contextEngine.detectAndResolveReferences({
                    promptText: params.promptText,
                    repositoryId: params.repositoryId,
                    repositoryName: params.repositoryName,
                    organizationAndTeamData: params.organizationAndTeamData,
                    context: params.context,
                    byokConfig: params.byokConfig,
                });

            // If no references found AND no errors, delete/skip save
            // BUT if there are errors, we MUST save them to inform the user
            if (
                references.length === 0 &&
                (!syncErrors || syncErrors.length === 0)
            ) {
                if (existing?.uuid) {
                    await this.repository.delete(existing.uuid);
                    this.logger.log({
                        message: 'No references found, deleted existing record',
                        context: PromptExternalReferenceManagerService.name,
                        metadata: {
                            configKey: params.configKey,
                            sourceType: params.sourceType,
                        },
                    });
                } else {
                    this.logger.log({
                        message: 'No references found, skipping save',
                        context: PromptExternalReferenceManagerService.name,
                        metadata: {
                            configKey: params.configKey,
                            sourceType: params.sourceType,
                        },
                    });
                }
                return { entity: null, wasProcessed: true };
            }

            const entity = await this.repository.upsert({
                configKey: params.configKey,
                sourceType: params.sourceType,
                organizationId: params.organizationId,
                repositoryId: params.repositoryId,
                directoryId: params.directoryId,
                kodyRuleId: params.kodyRuleId,
                repositoryName: params.repositoryName,
                promptHash: currentHash,
                references,
                syncErrors,
                lastProcessedAt: new Date(),
            });

            if (
                references.length === 0 &&
                syncErrors &&
                syncErrors.length > 0
            ) {
                this.logger.warn({
                    message:
                        'Saved error state: references detected but not found',
                    context: PromptExternalReferenceManagerService.name,
                    metadata: {
                        configKey: params.configKey,
                        sourceType: params.sourceType,
                        syncErrorsCount: syncErrors.length,
                    },
                });
            } else {
                this.logger.log({
                    message: 'Successfully processed prompt references',
                    context: PromptExternalReferenceManagerService.name,
                    metadata: {
                        configKey: params.configKey,
                        sourceType: params.sourceType,
                        referencesFound: references.length,
                        syncErrorsCount: syncErrors?.length || 0,
                    },
                });
            }

            return { entity, wasProcessed: true };
        } catch (error) {
            this.logger.error({
                message: 'Error processing prompt references',
                context: PromptExternalReferenceManagerService.name,
                error,
                metadata: {
                    configKey: params.configKey,
                    sourceType: params.sourceType,
                    organizationAndTeamData: params.organizationAndTeamData,
                },
            });
            return { entity: null, wasProcessed: false };
        }
    }

    buildConfigKey(
        organizationId: string,
        repositoryId: string,
        directoryId?: string,
    ): string {
        if (directoryId) {
            return `${organizationId}:${repositoryId}:${directoryId}`;
        }
        return `${organizationId}:${repositoryId}`;
    }

    buildConfigKeysHierarchy(
        organizationId: string,
        repositoryId: string,
        directoryId?: string,
    ): string[] {
        const keys = [];

        if (directoryId) {
            keys.push(`${organizationId}:${repositoryId}:${directoryId}`);
        }

        keys.push(`${organizationId}:${repositoryId}`);
        keys.push(`${organizationId}:global`);

        return keys;
    }

    async findByConfigKeys(
        configKeys: string[],
    ): Promise<PromptExternalReferenceEntity[]> {
        return this.repository.findByConfigKeys(configKeys);
    }

    async findByConfigKey(
        configKey: string,
        sourceType: PromptSourceType,
    ): Promise<PromptExternalReferenceEntity | null> {
        return this.repository.findByConfigKey(configKey, sourceType);
    }

    async delete(uuid: string): Promise<boolean> {
        return this.repository.delete(uuid);
    }

    async createOrUpdatePendingReference(params: {
        promptText: string;
        configKey: string;
        sourceType: PromptSourceType;
        organizationId: string;
        repositoryId: string;
        repositoryName: string;
        directoryId?: string;
        kodyRuleId?: string;
        organizationAndTeamData: OrganizationAndTeamData;
    }): Promise<PromptExternalReferenceEntity | null> {
        try {
            const existing = await this.repository.findByConfigKey(
                params.configKey,
                params.sourceType,
            );

            const hasExternalReferences = this.hasLikelyExternalReferences(
                params.promptText,
            );

            if (!hasExternalReferences) {
                if (existing?.uuid) {
                    await this.repository.delete(existing.uuid);
                    this.logger.log({
                        message:
                            'No external references pattern detected, deleted existing record',
                        context: PromptExternalReferenceManagerService.name,
                        metadata: {
                            configKey: params.configKey,
                            sourceType: params.sourceType,
                            organizationAndTeamData:
                                params.organizationAndTeamData,
                        },
                    });
                }
                return null;
            }

            const currentHash = this.contextEngine.calculatePromptHash(
                params.promptText,
            );

            if (existing && existing.promptHash === currentHash) {
                this.logger.log({
                    message: 'Prompt hash unchanged, returning existing record',
                    context: PromptExternalReferenceManagerService.name,
                    metadata: {
                        configKey: params.configKey,
                        sourceType: params.sourceType,
                        promptHash: currentHash,
                        currentStatus: existing.processingStatus,
                    },
                });
                return existing;
            }

            const entity = await this.repository.upsert({
                configKey: params.configKey,
                sourceType: params.sourceType,
                organizationId: params.organizationId,
                repositoryId: params.repositoryId,
                directoryId: params.directoryId,
                kodyRuleId: params.kodyRuleId,
                repositoryName: params.repositoryName,
                promptHash: currentHash,
                references: [],
                syncErrors: [],
                processingStatus: PromptProcessingStatus.PENDING,
                lastProcessedAt: new Date(),
            });

            this.logger.log({
                message: 'Created pending reference record',
                context: PromptExternalReferenceManagerService.name,
                metadata: {
                    configKey: params.configKey,
                    sourceType: params.sourceType,
                    promptHash: currentHash,
                },
            });

            return entity;
        } catch (error) {
            this.logger.error({
                message: 'Error creating pending reference',
                context: PromptExternalReferenceManagerService.name,
                error,
                metadata: {
                    configKey: params.configKey,
                    sourceType: params.sourceType,
                },
            });
            return null;
        }
    }

    private hasLikelyExternalReferences(promptText: string): boolean {
        const patterns = [
            /@file[:\s]/i,
            /\[\[file:/i,
            /@\w+\.(ts|js|py|md|yml|yaml|json|txt)/i,
            /refer to.*\.(ts|js|py|md|yml|yaml|json|txt)/i,
            /check.*\.(ts|js|py|md|yml|yaml|json|txt)/i,
            /see.*\.(ts|js|py|md|yml|yaml|json|txt)/i,
            /\b\w+\.\w+\.(ts|js|py|md|yml|yaml|json|txt)\b/i,
            /\b[A-Z_][A-Z0-9_]*\.(ts|js|py|md|yml|yaml|json|txt)\b/,
            /\b(readme|contributing|changelog|license|setup|config|package|tsconfig|jest\.config|vite\.config|webpack\.config)\.(md|json|yml|yaml|ts|js)\b/i,
        ];

        return patterns.some((pattern) => pattern.test(promptText));
    }

    async processReferencesInBackground(params: {
        promptText: string;
        configKey: string;
        sourceType: PromptSourceType;
        organizationId: string;
        repositoryId: string;
        repositoryName: string;
        directoryId?: string;
        kodyRuleId?: string;
        organizationAndTeamData: OrganizationAndTeamData;
        context?: 'rule' | 'instruction' | 'prompt';
        byokConfig?: BYOKConfig;
    }): Promise<void> {
        try {
            await this.repository.updateStatus(
                params.configKey,
                params.sourceType,
                PromptProcessingStatus.PROCESSING,
            );

            this.logger.log({
                message: 'Started background processing of references',
                context: PromptExternalReferenceManagerService.name,
                metadata: {
                    configKey: params.configKey,
                    sourceType: params.sourceType,
                },
            });

            const { references, syncErrors } =
                await this.contextEngine.detectAndResolveReferences({
                    promptText: params.promptText,
                    repositoryId: params.repositoryId,
                    repositoryName: params.repositoryName,
                    organizationAndTeamData: params.organizationAndTeamData,
                    context: params.context,
                    byokConfig: params.byokConfig,
                });

            const currentHash = this.contextEngine.calculatePromptHash(
                params.promptText,
            );

            if (
                references.length === 0 &&
                (!syncErrors || syncErrors.length === 0)
            ) {
                const existing = await this.repository.findByConfigKey(
                    params.configKey,
                    params.sourceType,
                );

                if (existing?.uuid && existing.promptHash === currentHash) {
                    await this.repository.delete(existing.uuid);
                    this.logger.log({
                        message: 'No references found, deleted record',
                        context: PromptExternalReferenceManagerService.name,
                        metadata: {
                            configKey: params.configKey,
                            sourceType: params.sourceType,
                        },
                    });
                } else if (existing?.promptHash !== currentHash) {
                    this.logger.warn({
                        message:
                            'Aborting stale background job; record has been updated or deleted.',
                        context: PromptExternalReferenceManagerService.name,
                        metadata: {
                            configKey: params.configKey,
                            sourceType: params.sourceType,
                            expectedHash: currentHash,
                            actualHash: existing?.promptHash,
                        },
                    });
                }
                return;
            }

            const finalStatus =
                syncErrors && syncErrors.length > 0
                    ? PromptProcessingStatus.FAILED
                    : PromptProcessingStatus.COMPLETED;

            const upsertResult = await this.repository.upsertConditional(
                {
                    configKey: params.configKey,
                    sourceType: params.sourceType,
                    organizationId: params.organizationId,
                    repositoryId: params.repositoryId,
                    directoryId: params.directoryId,
                    kodyRuleId: params.kodyRuleId,
                    repositoryName: params.repositoryName,
                    promptHash: currentHash,
                    references,
                    syncErrors,
                    processingStatus: finalStatus,
                    lastProcessedAt: new Date(),
                },
                currentHash,
            );

            if (!upsertResult) {
                this.logger.warn({
                    message:
                        'Aborting stale background job; record has been updated or deleted.',
                    context: PromptExternalReferenceManagerService.name,
                    metadata: {
                        configKey: params.configKey,
                        sourceType: params.sourceType,
                        expectedHash: currentHash,
                    },
                });
                return;
            }

            if (finalStatus === PromptProcessingStatus.FAILED) {
                this.logger.warn({
                    message: 'Background processing completed with errors',
                    context: PromptExternalReferenceManagerService.name,
                    metadata: {
                        configKey: params.configKey,
                        sourceType: params.sourceType,
                        syncErrorsCount: syncErrors?.length || 0,
                    },
                });
            } else {
                this.logger.log({
                    message: 'Background processing completed successfully',
                    context: PromptExternalReferenceManagerService.name,
                    metadata: {
                        configKey: params.configKey,
                        sourceType: params.sourceType,
                        referencesFound: references.length,
                    },
                });
            }
        } catch (error) {
            this.logger.error({
                message: 'Error in background processing',
                context: PromptExternalReferenceManagerService.name,
                error,
                metadata: {
                    configKey: params.configKey,
                    sourceType: params.sourceType,
                },
            });

            await this.repository
                .updateStatus(
                    params.configKey,
                    params.sourceType,
                    PromptProcessingStatus.FAILED,
                )
                .catch((updateError) => {
                    this.logger.error({
                        message: 'Failed to update status to FAILED',
                        context: PromptExternalReferenceManagerService.name,
                        error: updateError,
                    });
                });
        }
    }

    async getReference(
        configKey: string,
        sourceType: PromptSourceType,
    ): Promise<PromptExternalReferenceEntity | null> {
        try {
            return await this.repository.findByConfigKey(configKey, sourceType);
        } catch (error) {
            this.logger.error({
                message: 'Failed to get prompt external reference',
                context: PromptExternalReferenceManagerService.name,
                error,
                metadata: { configKey, sourceType },
            });
            return null;
        }
    }

    async getMultipleReferences(
        configKey: string,
        sourceTypes: PromptSourceType[],
    ): Promise<Map<PromptSourceType, PromptExternalReferenceEntity>> {
        try {
            const references =
                await this.repository.findByConfigKeyAndSourceTypes(
                    configKey,
                    sourceTypes,
                );

            const resultMap = new Map<
                PromptSourceType,
                PromptExternalReferenceEntity
            >();

            if (references && Array.isArray(references)) {
                for (const ref of references) {
                    resultMap.set(ref.sourceType, ref);
                }
            }

            return resultMap;
        } catch (error) {
            this.logger.error({
                message: 'Failed to get multiple prompt external references',
                context: PromptExternalReferenceManagerService.name,
                error,
                metadata: { configKey, sourceTypes },
            });
            return new Map();
        }
    }
}
