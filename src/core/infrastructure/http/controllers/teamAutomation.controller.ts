import {
    BadRequestException,
    Body,
    Controller,
    Get,
    InternalServerErrorException,
    Post,
    Query,
} from '@nestjs/common';
import { GetTeamAutomationUseCase } from '@/core/application/use-cases/teamAutomation/getTeamAutomationUseCase';
import { TeamQueryDto } from '../dtos/teamId-query-dto';
import { TeamAutomationsDto } from '../dtos/team-automation.dto';
import { ListAllTeamAutomationUseCase } from '@/core/application/use-cases/teamAutomation/listAllTeamAutomationUseCase';
import { UpdateTeamAutomationStatusUseCase } from '@/core/application/use-cases/teamAutomation/updateTeamAutomationStatusUseCase';
import { AutomationType } from '@/core/domain/automation/enums/automation-type';
import { OrganizationAndTeamDataDto } from '../dtos/organizationAndTeamData.dto';
import { PinoLoggerService } from '../../adapters/services/logger/pino.service';

@Controller('team-automation')
export class TeamAutomationController {
    constructor(
        private readonly getTeamAutomationUseCase: GetTeamAutomationUseCase,
        private readonly listAllTeamAutomationUseCase: ListAllTeamAutomationUseCase,
        private readonly updateTeamAutomationStatusUseCase: UpdateTeamAutomationStatusUseCase,

        private readonly logger: PinoLoggerService,
    ) {}

    @Get('/')
    public async GetTeamAutomationUseCase(@Query() query: TeamQueryDto) {
        return this.getTeamAutomationUseCase.execute(query.teamId);
    }

    @Get('/list-all')
    public async ListAllTeamAutomationUseCase(@Query() query: TeamQueryDto) {
        return this.listAllTeamAutomationUseCase.execute(query.teamId);
    }

    @Post('/update-status')
    public async changeStatus(
        @Body() body: { teamAutomationId: string; status: boolean },
    ) {
        return await this.updateTeamAutomationStatusUseCase.execute(
            body.teamAutomationId,
            body.status,
        );
    }
}
