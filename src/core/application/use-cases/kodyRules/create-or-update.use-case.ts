import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { KODY_RULES_SERVICE_TOKEN } from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { IKodyRulesService } from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { AuthorizationService } from '@/core/infrastructure/adapters/services/permissions/authorization.service';
import { CreateKodyRuleDto } from '@/core/infrastructure/http/dtos/create-kody-rule.dto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { ExternalReferenceDetectorService } from '@/core/infrastructure/adapters/services/kodyRules/externalReferenceDetector.service';
import {
    IGetAdditionalInfoHelper,
    GET_ADDITIONAL_INFO_HELPER_TOKEN,
} from '@/shared/domain/contracts/getAdditionalInfo.helper.contract';
import { PromptSourceType } from '@/core/domain/prompts/interfaces/promptExternalReference.interface';
import { ContextReferenceDetectionService } from '@/core/infrastructure/adapters/services/context/context-reference-detection.service';

@Injectable()
export class CreateOrUpdateKodyRulesUseCase {
    constructor(
        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        private readonly logger: PinoLoggerService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: {
                organization: { uuid: string };
                uuid: string;
                email: string;
            };
        },

        private readonly authorizationService: AuthorizationService,
        private readonly externalReferenceDetectorService: ExternalReferenceDetectorService,
        private readonly contextReferenceDetectionService: ContextReferenceDetectionService,
        @Inject(GET_ADDITIONAL_INFO_HELPER_TOKEN)
        private readonly getAdditionalInfoHelper: IGetAdditionalInfoHelper,
    ) {}

    async execute(
        kodyRule: CreateKodyRuleDto,
        organizationId: string,
        userInfo?: { userId: string; userEmail: string },
    ) {
        try {
            const organizationAndTeamData: OrganizationAndTeamData = {
                organizationId,
            };

            const req: any = this.request as any;
            const reqUser = req?.user;
            const userInfoData =
                userInfo ||
                (reqUser?.uuid && reqUser?.email
                    ? { userId: reqUser.uuid, userEmail: reqUser.email }
                    : { userId: 'kody-system', userEmail: 'kody@kodus.io' });

            if (userInfoData.userId !== 'kody-system') {
                await this.authorizationService.ensure({
                    user: this.request.user,
                    action: Action.Create,
                    resource: ResourceType.KodyRules,
                    repoIds: kodyRule.repositoryId
                        ? [kodyRule.repositoryId]
                        : undefined,
                });
            }

            const result = await this.kodyRulesService.createOrUpdate(
                organizationAndTeamData,
                kodyRule,
                userInfoData,
            );

            if (!result) {
                throw new NotFoundException(
                    'Failed to create or update kody rule',
                );
            }

            // ✅ Se tem repositoryId e rule text, processa referências
            if (result.uuid && kodyRule.repositoryId && kodyRule.rule) {
                this.logger.log({
                    message:
                        'Rule created/updated, triggering reference detection',
                    context: CreateOrUpdateKodyRulesUseCase.name,
                    metadata: {
                        ruleId: result.uuid,
                        ruleTitle: kodyRule.title,
                        repositoryId: kodyRule.repositoryId,
                        hasRuleText: !!kodyRule.rule,
                        ruleTextLength: kodyRule.rule.length,
                        organizationAndTeamData,
                    },
                });

                // ✅ Processa referências (status fica no Context OS)
                this.detectAndSaveReferencesAsync(
                    result.uuid,
                    kodyRule.rule,
                    kodyRule.repositoryId,
                    organizationAndTeamData,
                ).catch((error) => {
                    this.logger.error({
                        message:
                            'Background reference detection failed completely',
                        context: CreateOrUpdateKodyRulesUseCase.name,
                        error,
                        metadata: {
                            ruleId: result.uuid,
                            ruleTitle: kodyRule.title,
                            organizationAndTeamData,
                        },
                    });
                });
            } else {
                this.logger.warn({
                    message:
                        'Reference detection skipped - missing required fields',
                    context: CreateOrUpdateKodyRulesUseCase.name,
                    metadata: {
                        ruleId: result.uuid,
                        hasRepositoryId: !!kodyRule.repositoryId,
                        hasRuleText: !!kodyRule.rule,
                        repositoryId: kodyRule.repositoryId,
                        organizationAndTeamData,
                    },
                });
            }

            return result;
        } catch (error) {
            this.logger.error({
                message: 'Could not create or update Kody rules',
                context: CreateOrUpdateKodyRulesUseCase.name,
                serviceName: 'CreateOrUpdateKodyRulesUseCase',
                error: error,
                metadata: {
                    kodyRule,
                    organizationAndTeamData: {
                        organizationId,
                    },
                },
            });
            throw error;
        }
    }

    private async detectAndSaveReferencesAsync(
        ruleId: string,
        ruleText: string,
        repositoryId: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<void> {
        return new Promise((resolve) => {
            setImmediate(async () => {
                try {
                    let repositoryName: string;
                    try {
                        // Para repositoryId "global", usar o próprio ID como nome
                        if (repositoryId === 'global') {
                            repositoryName = 'global';
                        } else {
                            repositoryName =
                                await this.getAdditionalInfoHelper.getRepositoryNameByOrganizationAndRepository(
                                    organizationAndTeamData.organizationId,
                                    repositoryId,
                                );
                        }
                    } catch (error) {
                        this.logger.warn({
                            message:
                                'Failed to resolve repository name, using ID as fallback',
                            context: CreateOrUpdateKodyRulesUseCase.name,
                            error,
                            metadata: {
                                repositoryId,
                                organizationAndTeamData,
                            },
                        });
                        repositoryName = repositoryId;
                    }

                    // ✅ Usa o serviço compartilhado para detecção e salvamento
                    const contextReferenceId = await this.contextReferenceDetectionService.detectAndSaveReferences({
                        entityType: 'kodyRule',
                        entityId: ruleId,
                        text: ruleText,
                        path: ['kodyRule', ruleId],
                        sourceType: PromptSourceType.KODY_RULE,
                        repositoryId,
                        repositoryName,
                        organizationAndTeamData,
                        detectionMode: 'rule',
                    });

                    // ✅ Atualiza apenas o contextReferenceId na kodyRule
                    await this.kodyRulesService.updateRuleReferences(
                        organizationAndTeamData.organizationId,
                        ruleId,
                        {
                            contextReferenceId,
                        },
                    );

                    this.logger.log({
                        message: 'KodyRule successfully processed with Context OS',
                        context: CreateOrUpdateKodyRulesUseCase.name,
                        metadata: {
                            ruleId,
                            contextReferenceId,
                            repositoryId,
                        },
                    });

                } catch (error) {
                    this.logger.error({
                        message: 'Failed to process kodyRule with Context OS',
                        context: CreateOrUpdateKodyRulesUseCase.name,
                        error,
                        metadata: {
                            ruleId,
                            repositoryId,
                            organizationAndTeamData,
                        },
                    });
                }

                resolve();
            });
        });
    }
}
