import { Inject, Injectable } from '@nestjs/common';
import { IPipeline } from '../pipeline/interfaces/pipeline.interface';
import { CodeReviewPipelineContext } from '../codeBase/codeReviewPipeline/context/code-review-pipeline.context';
import { DryRunCodeReviewPipelineStrategy } from './dry-run-cr-pipeline.strategy';
import { PipelineExecutor } from '../pipeline/pipeline-executor.service';
import { PinoLoggerService } from '../logger/pino.service';

@Injectable()
export class DryRunCodeReviewPipeline
    implements IPipeline<CodeReviewPipelineContext>
{
    pipeLineName: string = 'DryRunCodeReviewPipeline';

    constructor(
        private readonly dryRunCodeReviewPipelineStrategy: DryRunCodeReviewPipelineStrategy,
        private readonly logger: PinoLoggerService,
    ) {}

    async execute(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        const stages = this.dryRunCodeReviewPipelineStrategy.configureStages();
        const executor = new PipelineExecutor(this.logger);

        const result = await executor.execute(
            context,
            stages,
            this.dryRunCodeReviewPipelineStrategy.getPipelineName(),
        );

        return result as CodeReviewPipelineContext;
    }
}
