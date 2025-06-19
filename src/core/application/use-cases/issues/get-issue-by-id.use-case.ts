import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';

import {
    CODE_REVIEW_FEEDBACK_SERVICE_TOKEN,
    ICodeReviewFeedbackService,
} from '@/core/domain/codeReviewFeedback/contracts/codeReviewFeedback.service.contract';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { IssuesService } from '@/ee/issues/issues.service';
import { IIssue, IIssueDetails } from '@/shared/interfaces/issues.interface';

@Injectable()
export class GetIssueByIdUseCase implements IUseCase {
    constructor(
        private readonly issuesService: IssuesService,

        @Inject(CODE_REVIEW_FEEDBACK_SERVICE_TOKEN)
        private readonly codeReviewFeedbackService: ICodeReviewFeedbackService,
    ) {}

    async execute(id: string): Promise<IIssueDetails | null> {
        const issue = await this.issuesService.findIssueById(id);

        if (!issue) {
            return null;
        }

        const codeReviewFeedback =
            await this.codeReviewFeedbackService.getByOrganizationId(
                issue.organizationId,
            );

        const reactions = await this.calculateTotalReactions(
            issue,
            codeReviewFeedback,
        );

        const dataToBuildUrls = {
            platform: issue.provider as PlatformType,
            repositoryName: issue.repository.name,
            repositoryFullName: issue.repository.fullName,
        };

        return {
            title: issue.title,
            description: issue.description,
            age: await this.issuesService.ageCalculation(issue),
            label: issue.label,
            severity: issue.severity,
            status: issue.status,
            fileLink: {
                label: issue.filePath,
                url: this.buildFileUrl(dataToBuildUrls, issue.file.path),
            },
            prLink:
                {
                    label: issue.prNumber.toString(),
                    url: issue.prUrl || '',
                },
            repositoryLink: {
                label: issue.repository.name,
                url: this.buildRepositoryUrl(dataToBuildUrls),
            },
            existingCode: issue.suggestion.existingCode,
            improvedCode: issue.suggestion.improvedCode,
            language: issue.language,
            startLine: issue.suggestion.relevantLinesStart,
            endLine: issue.suggestion.relevantLinesEnd,
            reactions,
            gitOrganizationName: issue.repository.fullName.split('/')[0],
            platform: issue.provider as PlatformType,
        };
    }

    //#region Auxiliary functions
    private async calculateTotalReactions(
        issue: IIssue,
        codeReviewFeedback: any[],
    ): Promise<{ thumbsUp: number; thumbsDown: number }> {
        const suggestionIds = new Set<string>();

        if (issue.suggestion?.id) {
            suggestionIds.add(issue.suggestion.id);
        }

        const allRelevantFeedbacks = codeReviewFeedback.filter(
            (feedback) =>
                feedback?.suggestionId &&
                suggestionIds.has(feedback.suggestionId),
        );

        let totalThumbsUp = 0;
        let totalThumbsDown = 0;

        allRelevantFeedbacks.forEach((feedback) => {
            if (feedback.reactions) {
                if (typeof feedback.reactions.thumbsUp === 'number') {
                    totalThumbsUp += feedback.reactions.thumbsUp;
                }
                if (typeof feedback.reactions.thumbsDown === 'number') {
                    totalThumbsDown += feedback.reactions.thumbsDown;
                }
            }
        });

        return {
            thumbsUp: totalThumbsUp,
            thumbsDown: totalThumbsDown,
        };
    }
    //#endregion

    //#region Build URLs
    private buildFileUrl(
        data: {
            platform: PlatformType;
            repositoryName: string;
            repositoryFullName: string;
        },
        filePath: string,
        branch: string = 'main',
    ): string {
        const cleanFilePath = filePath?.startsWith('/')
            ? filePath.substring(1)
            : filePath;

        switch (data.platform) {
            case PlatformType.GITHUB:
                return `https://github.com/${data.repositoryFullName}/blob/${branch}/${cleanFilePath}`;
            case PlatformType.GITLAB:
                return `https://gitlab.com/${data.repositoryFullName}/-/blob/${branch}/${cleanFilePath}`;
            case PlatformType.AZURE_REPOS:
                return `https://dev.azure.com/${data.repositoryFullName}/_git/${data.repositoryName}?path=/${cleanFilePath}`;
            case PlatformType.BITBUCKET:
                return `https://bitbucket.org/${data.repositoryFullName}/src/${branch}/${cleanFilePath}`;
            default:
                throw new Error(`Plataforma não suportada: ${data.platform}`);
        }
    }

    private buildRepositoryUrl(data: {
        platform: PlatformType;
        repositoryFullName: string;
    }): string {
        switch (data.platform) {
            case PlatformType.GITHUB:
                return `https://github.com/${data.repositoryFullName}`;
            case PlatformType.GITLAB:
                return `https://gitlab.com/${data.repositoryFullName}`;
            case PlatformType.AZURE_REPOS:
                return `https://dev.azure.com/${data.repositoryFullName}`;
            case PlatformType.BITBUCKET:
                return `https://bitbucket.org/${data.repositoryFullName}`;
            default:
                throw new Error(`Plataforma não suportada: ${data.platform}`);
        }
    }
    //#endregion
}
