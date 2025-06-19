import { Inject, Injectable } from '@nestjs/common';
import { IIssue, IIssueDetails, IssuesFilters } from '@/shared/interfaces/issues.interface';
import {
    IPullRequestsService,
    PULL_REQUESTS_SERVICE_TOKEN,
} from '@/core/domain/pullRequests/contracts/pullRequests.service.contracts';
import { GetIssuesByFiltersDto } from '@/core/infrastructure/http/dtos/get-issues-by-filters.dto';

@Injectable()
export class IssuesService {
    constructor(
        @Inject(PULL_REQUESTS_SERVICE_TOKEN)
        private readonly pullRequestsService: IPullRequestsService,
    ) {}

    async findIssuesWithFilters(
        organizationId: string,
        filters: IssuesFilters = {},
    ): Promise<any[]> {
        return this.pullRequestsService.findIssuesWithFilters(
            organizationId,
            filters,
        );
    }

    async findIssueById(
        suggestionId: string,
    ): Promise<IIssue> {
        return this.pullRequestsService.findIssueById(
            suggestionId,
        );
    }

    async ageCalculation(issue: IIssue): Promise<string> {
        const now = new Date();
        const createdAt = new Date(issue.createdAt);

        const diffTime = Math.abs(now.getTime() - createdAt.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        const daysText = diffDays === 1 ? 'day' : 'days';

        return `${diffDays} ${daysText} ago`;
    }

    async buildFilter(filters: GetIssuesByFiltersDto): Promise<any> {
        const filter: any = {};

        if (filters.title) {
            filter['title'] = { $regex: filters.title, $options: 'i' };
        }

        const exactMatchFields = [
            'severity',
            'category',
            'organizationId',
            'filePath',
        ];
        exactMatchFields.forEach((field) => {
            if (filters[field]) {
                filter[field] = filters[field];
            }
        });

        if (filters.repositoryName) {
            filter['repository.name'] = {
                $regex: filters.repositoryName,
                $options: 'i',
            };
        }

        if (filters.beforeAt || filters.afterAt) {
            filter['createdAt'] = {};

            if (filters.beforeAt) {
                filter['createdAt'].$lt = new Date(filters.beforeAt);
            }

            if (filters.afterAt) {
                filter['createdAt'].$gt = new Date(filters.afterAt);
            }
        }

        return filter;
    }
}
