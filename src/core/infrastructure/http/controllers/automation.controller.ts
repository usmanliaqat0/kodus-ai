import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { TeamQueryDto } from '../dtos/teamId-query-dto';
import { AutomationType } from '@/core/domain/automation/enums/automation-type';
import { OrganizationAndTeamDataDto } from '../dtos/organizationAndTeamData.dto';
import { GetAllAutomationsUseCase } from '@/core/application/use-cases/automation/get-all-automations.use-case';
import { getAllAutomationExecutionsUseCase } from '@/core/application/use-cases/automation/get-all-executions.use-case';
import {
    Action,
    ResourceType,
} from '@/core/domain/permissions/enums/permissions.enum';
import {
    PolicyGuard,
    CheckPolicies,
} from '../../adapters/services/permissions/policy.guard';
import { checkPermissions } from '../../adapters/services/permissions/policy.handlers';

@Controller('automation')
export class AutomationController {
    constructor(
        private readonly getAllAutomationsUseCase: GetAllAutomationsUseCase,
        private readonly getAllAutomationExecutionsUseCase: getAllAutomationExecutionsUseCase,
    ) {}

    @Get('/')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.CodeReviewSettings),
    )
    public async getAllAutomations(@Query() query: TeamQueryDto) {
        return this.getAllAutomationsUseCase.execute(query.teamId);
    }

    @Get('/executions')
    @UseGuards(PolicyGuard)
    @CheckPolicies(
        checkPermissions(Action.Read, ResourceType.CodeReviewSettings),
    )
    public async getAllAutomationExecutions(@Query() query: TeamQueryDto) {
        return this.getAllAutomationExecutionsUseCase.execute(query);
    }
}
