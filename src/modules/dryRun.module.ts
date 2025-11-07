import { DRY_RUN_REPOSITORY_TOKEN } from '@/core/domain/dryRun/contracts/dryRun.repository.contract';
import { DRY_RUN_SERVICE_TOKEN } from '@/core/domain/dryRun/contracts/dryRun.service.contract';
import { DryRunRepository } from '@/core/infrastructure/adapters/repositories/mongoose/dryRun.repository';
import {
    DryRunModel,
    DryRunSchema,
} from '@/core/infrastructure/adapters/repositories/mongoose/schema/dryRun.model';
import { DryRunService } from '@/core/infrastructure/adapters/services/dryRun/dryRun.service';
import { InternalCodeManagementService } from '@/core/infrastructure/adapters/services/dryRun/internalCodeManagement.service';
import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ParametersModule } from './parameters.module';
import { PullRequestMessagesModule } from './pullRequestMessages.module';
import { CodebaseModule } from './codeBase.module';
import { DryRunCodeReviewPipelineStrategy } from '@/core/infrastructure/adapters/services/dryRun/dry-run-cr-pipeline.strategy';
import { DryRunCodeReviewPipeline } from '@/core/infrastructure/adapters/services/dryRun/dryRunPipeline';
import { UseCases } from '@/core/application/use-cases/dryRun';
import { CodeReviewPipelineModule } from './codeReviewPipeline.module';
import { PromptsModule } from './prompts.module';
import { DryRunController } from '@/core/infrastructure/http/controllers/dryRun.controller';
import { PlatformIntegrationModule } from './platformIntegration.module';
import { IntegrationConfigModule } from './integrationConfig.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: DryRunModel.name,
                schema: DryRunSchema,
            },
        ]),
        forwardRef(() => CodebaseModule),
        forwardRef(() => ParametersModule),
        forwardRef(() => PullRequestMessagesModule),
        forwardRef(() => CodeReviewPipelineModule),
        forwardRef(() => PromptsModule),
        forwardRef(() => PlatformIntegrationModule),
        forwardRef(() => IntegrationConfigModule),
    ],
    providers: [
        ...UseCases,
        DryRunCodeReviewPipeline,
        DryRunCodeReviewPipelineStrategy,
        InternalCodeManagementService,
        {
            provide: DRY_RUN_REPOSITORY_TOKEN,
            useClass: DryRunRepository,
        },
        {
            provide: DRY_RUN_SERVICE_TOKEN,
            useClass: DryRunService,
        },
    ],
    exports: [DryRunCodeReviewPipeline, DRY_RUN_SERVICE_TOKEN],
    controllers: [DryRunController],
})
export class DryRunModule {}
