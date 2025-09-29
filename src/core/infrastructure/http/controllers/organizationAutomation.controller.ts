import { GetOrganizationAutomationUseCase } from '@/core/application/use-cases/organizationAutomation/getOrganizationAutomationUseCase';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { OrganizationQueryDto } from '../dtos/organizationId-query.dto';
import { ActiveOrganizationAutomationsUseCase } from '@/core/application/use-cases/organizationAutomation/activeOrganizationAutomationsUseCase';
import { AutomationType } from '@/core/domain/automation/enums/automation-type';

@Controller('organization-automation')
export class OrganizationAutomationController {
    constructor(
        private readonly getOrganizationAutomationUseCase: GetOrganizationAutomationUseCase,
        private readonly activeOrganizationAutomationUseCase: ActiveOrganizationAutomationsUseCase,
    ) {}

    @Get('/')
    public async getOrganizationAutomations(
        @Query() query: OrganizationQueryDto,
    ) {
        return this.getOrganizationAutomationUseCase.execute(
            query.organizationId,
        );
    }

    @Post('/active-all')
    public async activeAllAutomations() {
        return await this.activeOrganizationAutomationUseCase.execute();
    }
}
