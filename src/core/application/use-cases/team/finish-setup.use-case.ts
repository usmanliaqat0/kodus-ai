import {
    ITeamService,
    TEAM_SERVICE_TOKEN,
} from '@/core/domain/team/contracts/team.service.contract';
import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { STATUS } from '@/config/types/database/status.type';
import { CreateOrUpdateParametersUseCase } from '../parameters/create-or-update-use-case';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { SeverityLevel } from '@/shared/utils/enums/severityLevel.enum';
import { CodeReviewVersion } from '@/config/types/general/codeReview.type';

@Injectable()
export class FinishSetupUseCase {
    constructor(
        @Inject(TEAM_SERVICE_TOKEN)
        private readonly teamService: ITeamService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string } };
        },

        private readonly createOrUpdateParametersUseCase: CreateOrUpdateParametersUseCase,
    ) {}

    async execute(teamId: string): Promise<any> {
        const team = await this.teamService.findById(teamId);

        if (!team) {
            return {
                started: false,
                message: 'Team not found.',
            };
        }

        await this.teamService.update(
            { uuid: team.uuid },
            { status: STATUS.ACTIVE },
        );

        const organizationId = this.request.user?.organization?.uuid;

        await this.createOrUpdateParametersUseCase.execute(
            ParametersKey.CODE_REVIEW_CONFIG,
            {
                ignorePaths: [
                    'packages.json',
                    'package-lock.json',
                    '.env',
                    'yarn.lock',
                ],
                reviewOptions: {
                    security: true,
                    code_style: true,
                    kody_rules: true,
                    refactoring: true,
                    error_handling: true,
                    maintainability: true,
                    potential_issues: true,
                    documentation_and_comments: true,
                    performance_and_optimization: true,
                    breaking_changes: true,
                    bug: true,
                    performance: true,
                    cross_file: true,
                },
                limitationType: 'pr',
                maxSuggestions: 8,
                severityLevelFilter: SeverityLevel.MEDIUM,
                codeReviewVersion: CodeReviewVersion.v2,
            },
            {
                teamId: teamId,
                organizationId: organizationId,
            },
        );

        return {
            started: true,
            message: 'Setup completed successfully.',
        };
    }
}
