import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import {
    PULL_REQUESTS_REPOSITORY_TOKEN,
    IPullRequestsRepository,
} from '@/core/domain/pullRequests/contracts/pullRequests.repository';
import {
    KODY_RULES_SERVICE_TOKEN,
    IKodyRulesService,
} from '@/core/domain/kodyRules/contracts/kodyRules.service.contract';
import { ISuggestion } from '@/core/domain/pullRequests/interfaces/pullRequests.interface';

@Injectable()
export class FindSuggestionsByRuleUseCase {
    constructor(
        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string } };
        },

        @Inject(PULL_REQUESTS_REPOSITORY_TOKEN)
        private readonly pullRequestsRepository: IPullRequestsRepository,

        @Inject(KODY_RULES_SERVICE_TOKEN)
        private readonly kodyRulesService: IKodyRulesService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(ruleId: string): Promise<ISuggestion[]> {
        try {
            if (!this.request.user.organization.uuid) {
                throw new BadRequestException('Organization ID not found');
            }

            if (!ruleId) {
                throw new BadRequestException('Rule ID is required');
            }

            const organizationId = this.request.user.organization.uuid;

            const existingRules = await this.kodyRulesService.findByOrganizationId(
                organizationId,
            );

            if (!existingRules) {
                throw new NotFoundException(
                    'No Kody rules found for the given organization ID',
                );
            }

            const rule = existingRules.rules.find((rule) => rule.uuid === ruleId);

            if (!rule) {
                throw new NotFoundException(
                    'Rule not found or does not belong to your organization',
                );
            }

            const suggestions = await this.pullRequestsRepository.findSuggestionsByRuleId(
                ruleId,
                organizationId,
            );

            if (!suggestions || suggestions.length === 0) {
                return [];
            }

            return suggestions;
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }

            this.logger.error({
                message: 'Error finding suggestions by rule ID',
                context: FindSuggestionsByRuleUseCase.name,
                error: error,
                metadata: {
                    ruleId,
                    organizationId: this.request.user.organization?.uuid,
                },
            });
            throw error;
        }
    }
}

