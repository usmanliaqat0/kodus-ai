import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    IOrganizationParametersService,
    ORGANIZATION_PARAMETERS_SERVICE_TOKEN,
} from '@/core/domain/organizationParameters/contracts/organizationParameters.service.contract';
import { ICockpitMetricsVisibility, DEFAULT_COCKPIT_METRICS_VISIBILITY } from '@/core/domain/organizationParameters/interfaces/cockpit-metrics-visibility.interface';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { OrganizationParametersKey } from '@/shared/domain/enums/organization-parameters-key.enum';
import { Inject, Injectable } from '@nestjs/common';

export const GET_COCKPIT_METRICS_VISIBILITY_USE_CASE_TOKEN = Symbol('GET_COCKPIT_METRICS_VISIBILITY_USE_CASE_TOKEN');

@Injectable()
export class GetCockpitMetricsVisibilityUseCase {
    constructor(
        @Inject(ORGANIZATION_PARAMETERS_SERVICE_TOKEN)
        private readonly organizationParametersService: IOrganizationParametersService,
        private readonly logger: PinoLoggerService,
    ) {}

    async execute(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<ICockpitMetricsVisibility> {
        try {
            const parameter =
                await this.organizationParametersService.findByKey(
                    OrganizationParametersKey.COCKPIT_METRICS_VISIBILITY,
                    organizationAndTeamData,
                );

            if (!parameter) {
                this.logger.log({
                    message: 'Cockpit metrics visibility config not found, returning default values (all true)',
                    context: GetCockpitMetricsVisibilityUseCase.name,
                    metadata: {
                        organizationId: organizationAndTeamData.organizationId,
                    },
                });
                return DEFAULT_COCKPIT_METRICS_VISIBILITY;
            }

            return parameter.configValue as ICockpitMetricsVisibility;
        } catch (error) {
            this.logger.error({
                message: 'Error getting cockpit metrics visibility, returning default values',
                context: GetCockpitMetricsVisibilityUseCase.name,
                error: error,
                metadata: {
                    organizationAndTeamData,
                },
            });

            return DEFAULT_COCKPIT_METRICS_VISIBILITY;
        }
    }
}

