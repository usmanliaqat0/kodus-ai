import { DatabaseConnection } from '@/config/types';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { AutomationStatus } from '@/core/domain/automation/enums/automation-status';
import {
    DRY_RUN_SERVICE_TOKEN,
    IDryRunService,
} from '@/core/domain/dryRun/contracts/dryRun.service.contract';
import { DryRunStatus } from '@/core/domain/dryRun/interfaces/dryRun.interface';
import {
    IIntegrationConfigService,
    INTEGRATION_CONFIG_SERVICE_TOKEN,
} from '@/core/domain/integrationConfigs/contracts/integration-config.service.contracts';
import { Repositories } from '@/core/domain/platformIntegrations/types/codeManagement/repositories.type';
import { CodeReviewPipelineContext } from '@/core/infrastructure/adapters/services/codeBase/codeReviewPipeline/context/code-review-pipeline.context';
import { DryRunCodeReviewPipeline } from '@/core/infrastructure/adapters/services/dryRun/dryRunPipeline';
import { ObservabilityService } from '@/core/infrastructure/adapters/services/logger/observability.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { TaskStatus } from '@/ee/kodyAST/codeASTAnalysis.service';
import { IntegrationConfigKey } from '@/shared/domain/enums/Integration-config-key.enum';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { IdGenerator } from '@kodus/flow';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ExecuteDryRunUseCase {
    private readonly config: DatabaseConnection;

    constructor(
        private readonly dryRunPipeline: DryRunCodeReviewPipeline,

        private readonly observabilityService: ObservabilityService,

        private readonly configService: ConfigService,

        private readonly codeManagementService: CodeManagementService,

        private readonly logger: PinoLoggerService,

        @Inject(DRY_RUN_SERVICE_TOKEN)
        private readonly dryRunService: IDryRunService,

        @Inject(INTEGRATION_CONFIG_SERVICE_TOKEN)
        private readonly integrationConfigService: IIntegrationConfigService,
    ) {
        this.config =
            this.configService.get<DatabaseConnection>('mongoDatabase');
    }

    execute(params: {
        organizationAndTeamData: {
            organizationId: string;
            teamId: string;
        };
        repositoryId: string;
        prNumber: number;
    }) {
        const correlationId = IdGenerator.correlationId();

        this.runDryRun({
            correlationId,
            ...params,
        });

        return correlationId;
    }

    private async runDryRun(params: {
        correlationId: string;
        organizationAndTeamData: {
            organizationId: string;
            teamId: string;
        };
        repositoryId: string;
        prNumber: number;
    }) {
        const {
            correlationId,
            organizationAndTeamData,
            prNumber,
            repositoryId,
        } = params;

        try {
            const platformType = await this.getPlatformType(
                organizationAndTeamData,
            );

            const repository = await this.getRepository(
                repositoryId,
                organizationAndTeamData,
            );

            const pullRequest = await this.getPullRequest(
                organizationAndTeamData,
                repository,
                prNumber,
            );

            const dryRun = await this.dryRunService.initializeDryRun({
                id: correlationId,
                organizationAndTeamData,
                provider: platformType,
                prNumber: pullRequest.number,
                prTitle: pullRequest.title,
                repositoryId: repository.id,
                repositoryName: repository.name,
            });

            await this.observabilityService.initializeObservability(
                this.config,
                {
                    serviceName: 'dryRunCodeReviewPipeline',
                    correlationId,
                },
            );

            const context = {
                dryRun: {
                    enabled: true,
                    id: dryRun.id,
                },
                statusInfo: {
                    status: AutomationStatus.IN_PROGRESS,
                    message: 'Pipeline started',
                },
                organizationAndTeamData,
                platformType,
                pullRequest,
                repository,
                pipelineVersion: '1.0.0',
                errors: [],
                pipelineMetadata: {
                    lastExecution: null,
                },
                batches: [],
                preparedFileContexts: [],
                validSuggestions: [],
                discardedSuggestions: [],
                lastAnalyzedCommit: null,
                validSuggestionsByPR: [],
                validCrossFileSuggestions: [],
                externalPromptContext: {},
                correlationId,
                tasks: {
                    astAnalysis: {
                        taskId: null,
                        status: TaskStatus.TASK_STATUS_UNSPECIFIED,
                    },
                },
            } as unknown as CodeReviewPipelineContext;

            const result = await this.dryRunPipeline.execute(context);

            if (result.dryRun?.id) {
                await this.dryRunService.updateDryRunStatus({
                    organizationAndTeamData,
                    id: result.dryRun.id,
                    status: DryRunStatus.COMPLETED,
                });
            }

            return result;
        } catch (error) {
            this.logger.error({
                message: 'Error executing dry run',
                error,
                metadata: params,
                context: ExecuteDryRunUseCase.name,
            });

            await this.dryRunService.updateDryRunStatus({
                organizationAndTeamData,
                id: correlationId,
                status: DryRunStatus.FAILED,
            });

            return null;
        }
    }

    private async getRepository(
        repositoryId: string,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<Repositories> {
        const repositories =
            await this.integrationConfigService.findIntegrationConfigFormatted<
                Repositories[]
            >(IntegrationConfigKey.REPOSITORIES, organizationAndTeamData);

        const repository = repositories.find(
            (repo) => repo.id === repositoryId,
        );

        if (!repository) {
            this.logger.warn({
                message: 'Repository not found for dry run',
                context: ExecuteDryRunUseCase.name,
                serviceName: ExecuteDryRunUseCase.name,
                metadata: {
                    organizationAndTeamData,
                    repositoryId,
                },
            });

            throw new Error('Repository not found');
        }

        return repository;
    }

    private async getPlatformType(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<PlatformType> {
        const platform = await this.codeManagementService.getTypeIntegration(
            organizationAndTeamData,
        );

        if (!platform) {
            this.logger.warn({
                message: 'Platform type not found for dry run',
                context: ExecuteDryRunUseCase.name,
                serviceName: ExecuteDryRunUseCase.name,
                metadata: {
                    organizationAndTeamData,
                },
            });

            throw new Error('Platform type not found');
        }

        return platform;
    }

    private async getPullRequest(
        organizationAndTeamData: OrganizationAndTeamData,
        repository: Repositories,
        prNumber: number,
    ) {
        const pr = await this.codeManagementService.getPullRequest({
            organizationAndTeamData,
            repository,
            prNumber,
        });

        if (!pr) {
            this.logger.warn({
                message: 'Pull request not found for dry run',
                context: ExecuteDryRunUseCase.name,
                serviceName: ExecuteDryRunUseCase.name,
                metadata: {
                    organizationAndTeamData,
                    repository,
                    prNumber,
                },
            });

            throw new Error('Pull request not found');
        }

        return pr;
    }
}
