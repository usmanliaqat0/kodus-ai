import {
    Body,
    Controller,
    Get,
    Inject,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { GetPullRequestAuthorsUseCase } from '@/core/application/use-cases/pullRequests/get-pull-request-authors-orderedby-contributions.use-case';
import { UpdatePullRequestToNewFormatUseCase } from '@/core/application/use-cases/pullRequests/update-pull-request-to-new-format.use-case';
import { GetEnrichedPullRequestsUseCase } from '@/core/application/use-cases/pullRequests/get-enriched-pull-requests.use-case';
import { BackfillHistoricalPRsUseCase } from '@/core/application/use-cases/pullRequests/backfill-historical-prs.use-case';
import { EnrichedPullRequestsQueryDto } from '../dtos/enriched-pull-requests-query.dto';
import { PaginatedEnrichedPullRequestsResponse } from '../dtos/paginated-enriched-pull-requests.dto';
import { BackfillPRsDto } from '../dtos/backfill-prs.dto';
import {
    CheckPolicies,
    PolicyGuard,
} from '../../adapters/services/permissions/policy.guard';
import { checkPermissions } from '../../adapters/services/permissions/policy.handlers';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import { REQUEST } from '@nestjs/core';
import { CodeManagementService } from '../../adapters/services/platformIntegration/codeManagement.service';

@Controller('pull-requests')
export class PullRequestController {
    constructor(
        private readonly getPullRequestAuthorsUseCase: GetPullRequestAuthorsUseCase,
        private readonly updatePullRequestToNewFormatUseCase: UpdatePullRequestToNewFormatUseCase,
        private readonly getEnrichedPullRequestsUseCase: GetEnrichedPullRequestsUseCase,
        private readonly backfillHistoricalPRsUseCase: BackfillHistoricalPRsUseCase,
        private readonly codeManagementService: CodeManagementService,
        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string } };
        },
    ) {}

    @Get('/get-pull-request-authors')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.Billing))
    public async getPullRequestAuthors(
        @Query() query: { organizationId: string },
    ) {
        return await this.getPullRequestAuthorsUseCase.execute(
            query.organizationId,
        );
    }

    @Get('/executions')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Read, ResourceType.PullRequests))
    public async getPullRequestExecutions(
        @Query() query: EnrichedPullRequestsQueryDto,
    ): Promise<PaginatedEnrichedPullRequestsResponse> {
        return await this.getEnrichedPullRequestsUseCase.execute(query);
    }

    @Post('/backfill')
    @UseGuards(PolicyGuard)
    @CheckPolicies(checkPermissions(Action.Create, ResourceType.PullRequests))
    public async backfillHistoricalPRs(@Body() body: BackfillPRsDto) {
        const { teamId, repositoryIds, startDate, endDate } = body;
        const organizationId = this.request.user?.organization?.uuid;

        const organizationAndTeamData = {
            organizationId,
            teamId,
        };

        let repositories = await this.codeManagementService.getRepositories({
            organizationAndTeamData,
        });

        if (!repositories || repositories.length === 0) {
            return {
                success: false,
                message: 'No repositories found',
            };
        }

        repositories = repositories.filter(
            (r: any) => r && (r.selected === true || r.isSelected === true),
        );

        if (repositoryIds && repositoryIds.length > 0) {
            repositories = repositories.filter(
                (r: any) =>
                    repositoryIds.includes(r.id) ||
                    repositoryIds.includes(String(r.id)),
            );
        }

        if (repositories.length === 0) {
            return {
                success: false,
                message: 'No selected repositories found',
            };
        }

        setImmediate(() => {
            this.backfillHistoricalPRsUseCase
                .execute({
                    organizationAndTeamData,
                    repositories: repositories.map((r: any) => ({
                        id: String(r.id),
                        name: r.name,
                        fullName:
                            r.fullName ||
                            r.full_name ||
                            `${r.organizationName || ''}/${r.name}`,
                    })),
                    startDate,
                    endDate,
                })
                .catch((error) => {
                    console.error('Error during manual PR backfill:', error);
                });
        });

        return {
            success: true,
            message: 'PR backfill started in background',
            repositoriesCount: repositories.length,
        };
    }
}
