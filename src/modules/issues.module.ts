import { Module } from '@nestjs/common';
import { IssuesController } from '@/core/infrastructure/http/controllers/issues.controller';
import { IssuesService } from '@/ee/issues/issues.service';
import { PullRequestsModule } from './pullRequests.module';
import { GetIssuesByFiltersUseCase } from '@/core/application/use-cases/issues/get-issues-by-filters.use-case';
import { GetIssueByIdUseCase } from '@/core/application/use-cases/issues/get-issue-by-id.use-case';
import { CodeReviewFeedbackModule } from './codeReviewFeedback.module';

const UseCases = [GetIssuesByFiltersUseCase, GetIssueByIdUseCase] as const;

@Module({
    imports: [PullRequestsModule, CodeReviewFeedbackModule],
    controllers: [IssuesController],
    providers: [...UseCases, IssuesService],
    exports: [...UseCases],
})
export class IssuesModule {}
