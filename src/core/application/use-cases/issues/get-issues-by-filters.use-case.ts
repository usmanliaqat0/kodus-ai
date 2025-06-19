import { GetIssuesByFiltersDto } from '@/core/infrastructure/http/dtos/get-issues-by-filters.dto';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';

import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { IssuesService } from '@/ee/issues/issues.service';
import { IIssue } from '@/shared/interfaces/issues.interface';
import {
    IPullRequestsService,
    PULL_REQUESTS_SERVICE_TOKEN,
} from '@/core/domain/pullRequests/contracts/pullRequests.service.contracts';

@Injectable()
export class GetIssuesByFiltersUseCase implements IUseCase {
    constructor(
        private readonly logger: PinoLoggerService,

        private readonly issuesService: IssuesService,

        @Inject(PULL_REQUESTS_SERVICE_TOKEN)
        private readonly pullRequestsService: IPullRequestsService,
    ) {}

    async execute(filters: GetIssuesByFiltersDto): Promise<IIssue[]> {
        try {
            const filter = await this.issuesService.buildFilter(filters);

            const issues = await this.pullRequestsService.findIssuesWithFilters(
                filters.organizationId,
                filter,
            );

            if (!issues || issues?.length === 0) {
                return [];
            }

            const mappedIssues: IIssue[] = await Promise.all(
                issues.map(async (issue) => ({
                    id: issue.suggestion.id,
                    title: issue.suggestion.oneSentenceSummary || issue.prTitle,
                    description: issue.suggestion.suggestionContent,
                    label: issue.suggestion.label,
                    severity: issue.suggestion.severity,
                    language: issue.suggestion.language,
                    age: await this.issuesService.ageCalculation(issue),
                    status: issue.suggestion.issueStatus,
                    createdAt: issue.prCreatedAt,
                    filePath: issue.file.path,
                    prNumber: issue.prNumber,
                    prAuthor: issue.prAuthor.name,
                    repositoryName: issue.repository.name,
                    organizationId: filters.organizationId,
                })),
            );

            return mappedIssues;
        } catch (error) {
            this.logger.error({
                context: GetIssuesByFiltersUseCase.name,
                message: 'Error getting issues by filters',
                error,
            });

            return [];
        }
    }
}
