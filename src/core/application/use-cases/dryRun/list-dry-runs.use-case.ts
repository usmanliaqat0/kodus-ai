import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    DRY_RUN_SERVICE_TOKEN,
    IDryRunService,
} from '@/core/domain/dryRun/contracts/dryRun.service.contract';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class ListDryRunsUseCase {
    constructor(
        @Inject(DRY_RUN_SERVICE_TOKEN)
        private readonly dryRunService: IDryRunService,

        private readonly logger: PinoLoggerService,
    ) {}

    async execute(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        filters?: {
            repositoryId?: string;
            directoryId?: string;
            startDate?: string;
            endDate?: string;
            prNumber?: string;
            status?: string;
        };
    }) {
        const { organizationAndTeamData, filters = {} } = params;
        const { directoryId, status } = filters;

        const startDate = filters.startDate
            ? new Date(filters.startDate)
            : undefined;
        const endDate = filters.endDate ? new Date(filters.endDate) : undefined;
        const prNumber = filters.prNumber
            ? parseInt(filters.prNumber, 10)
            : undefined;
        const repositoryId =
            filters.repositoryId === 'global'
                ? undefined
                : filters.repositoryId;

        return this.dryRunService.listDryRuns({
            organizationAndTeamData,
            filters: {
                repositoryId,
                directoryId,
                startDate,
                endDate,
                prNumber,
                status,
            },
        });
    }
}
