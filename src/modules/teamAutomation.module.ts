import { UseCases } from '@/core/application/use-cases/teamAutomation';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TEAM_AUTOMATION_REPOSITORY_TOKEN } from '@/core/domain/automation/contracts/team-automation.repository';
import { TEAM_AUTOMATION_SERVICE_TOKEN } from '@/core/domain/automation/contracts/team-automation.service';
import { TeamAutomationRepository } from '@/core/infrastructure/adapters/repositories/typeorm/teamAutomation.repository';
import { TeamAutomationService } from '@/core/infrastructure/adapters/services/automation/team-automation.service';
import { TeamAutomationModel } from '@/core/infrastructure/adapters/repositories/typeorm/schema/teamAutomation.model';
import { TeamAutomationController } from '@/core/infrastructure/http/controllers/teamAutomation.controller';
import { TeamsModule } from './team.module';
import { AutomationStrategyModule } from './automationStrategy.module';
import { OrganizationModule } from './organization.module';
import { AutomationModule } from './automation.module';
import { TeamMembersModule } from './teamMembers.module';
import { PlatformIntegrationModule } from './platformIntegration.module';
import { IntegrationConfigService } from '@/core/infrastructure/adapters/services/integrations/integrationConfig.service';
import { INTEGRATION_CONFIG_SERVICE_TOKEN } from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { IntegrationService } from '@/core/infrastructure/adapters/services/integrations/integration.service';
import { IntegrationModule } from './integration.module';
import { IntegrationConfigModule } from './integrationConfig.module';
import { ProfileConfigModule } from './profileConfig.module';
import { ActiveCodeManagementTeamAutomationsUseCase } from '@/core/application/use-cases/teamAutomation/active-code-manegement-automations.use-case';
import { ActiveCodeReviewAutomationUseCase } from '@/core/application/use-cases/teamAutomation/active-code-review-automation.use-case';
import { INTEGRATION_SERVICE_TOKEN } from '@/core/domain/integrations/contracts/integration.service.contracts';

@Module({
    imports: [
        TypeOrmModule.forFeature([TeamAutomationModel]),
        forwardRef(() => TeamsModule),
        forwardRef(() => AutomationStrategyModule),
        forwardRef(() => AutomationModule),
        forwardRef(() => PlatformIntegrationModule),
        forwardRef(() => IntegrationModule),
        forwardRef(() => IntegrationConfigModule),
        forwardRef(() => TeamMembersModule),
        forwardRef(() => OrganizationModule),
        forwardRef(() => TeamAutomationModule),
        ProfileConfigModule,
    ],
    providers: [
        ...UseCases,
        {
            provide: TEAM_AUTOMATION_REPOSITORY_TOKEN,
            useClass: TeamAutomationRepository,
        },
        {
            provide: TEAM_AUTOMATION_SERVICE_TOKEN,
            useClass: TeamAutomationService,
        },
        {
            provide: INTEGRATION_SERVICE_TOKEN,
            useClass: IntegrationService,
        },
        {
            provide: INTEGRATION_CONFIG_SERVICE_TOKEN,
            useClass: IntegrationConfigService,
        },
    ],
    controllers: [TeamAutomationController],
    exports: [
        TEAM_AUTOMATION_REPOSITORY_TOKEN,
        TEAM_AUTOMATION_SERVICE_TOKEN,
        INTEGRATION_SERVICE_TOKEN,
        INTEGRATION_CONFIG_SERVICE_TOKEN,
        ActiveCodeManagementTeamAutomationsUseCase,
        ActiveCodeReviewAutomationUseCase,
    ],
})
export class TeamAutomationModule {}
