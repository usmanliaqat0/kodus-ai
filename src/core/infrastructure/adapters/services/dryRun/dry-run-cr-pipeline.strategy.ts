import { Inject, Injectable } from '@nestjs/common';
import { CodeReviewPipelineContext } from '../codeBase/codeReviewPipeline/context/code-review-pipeline.context';
import { AggregateResultsStage } from '../codeBase/codeReviewPipeline/stages/aggregate-result.stage';
import {
    LOAD_EXTERNAL_CONTEXT_STAGE_TOKEN,
    ILoadExternalContextStage,
} from '../codeBase/codeReviewPipeline/stages/contracts/loadExternalContextStage.contract';
import { CreateFileCommentsStage } from '../codeBase/codeReviewPipeline/stages/create-file-comments.stage';
import { CreatePrLevelCommentsStage } from '../codeBase/codeReviewPipeline/stages/create-pr-level-comments.stage';
import { FetchChangedFilesStage } from '../codeBase/codeReviewPipeline/stages/fetch-changed-files.stage';
import { UpdateCommentsAndGenerateSummaryStage } from '../codeBase/codeReviewPipeline/stages/finish-comments.stage';
import { InitialCommentStage } from '../codeBase/codeReviewPipeline/stages/initial-comment.stage';
import { ProcessFilesPrLevelReviewStage } from '../codeBase/codeReviewPipeline/stages/process-files-pr-level-review.stage';
import { ProcessFilesReview } from '../codeBase/codeReviewPipeline/stages/process-files-review.stage';
import { ResolveConfigStage } from '../codeBase/codeReviewPipeline/stages/resolve-config.stage';
import { ValidateConfigStage } from '../codeBase/codeReviewPipeline/stages/validate-config.stage';
import { IPipelineStrategy } from '../pipeline/interfaces/pipeline-strategy.interface';
import { PipelineStage } from '../pipeline/interfaces/pipeline.interface';

@Injectable()
export class DryRunCodeReviewPipelineStrategy
    implements IPipelineStrategy<CodeReviewPipelineContext>
{
    constructor(
        private readonly resolveConfigStage: ResolveConfigStage,
        private readonly validateConfigStage: ValidateConfigStage,
        private readonly fetchChangedFilesStage: FetchChangedFilesStage,
        @Inject(LOAD_EXTERNAL_CONTEXT_STAGE_TOKEN)
        private readonly loadExternalContextStage: ILoadExternalContextStage,
        private readonly initialCommentStage: InitialCommentStage,
        private readonly processFilesPrLevelReviewStage: ProcessFilesPrLevelReviewStage,
        private readonly processFilesReview: ProcessFilesReview,
        private readonly createPrLevelCommentsStage: CreatePrLevelCommentsStage,
        private readonly createFileCommentsStage: CreateFileCommentsStage,
        private readonly aggregateResultsStage: AggregateResultsStage,
        private readonly updateCommentsAndGenerateSummaryStage: UpdateCommentsAndGenerateSummaryStage,
    ) {}

    configureStages(): PipelineStage<CodeReviewPipelineContext>[] {
        return [
            this.resolveConfigStage,
            this.validateConfigStage,
            this.fetchChangedFilesStage,
            this.loadExternalContextStage,
            this.initialCommentStage,
            this.processFilesPrLevelReviewStage,
            this.processFilesReview,
            this.createPrLevelCommentsStage,
            this.createFileCommentsStage,
            this.aggregateResultsStage,
            this.updateCommentsAndGenerateSummaryStage,
        ];
    }

    getPipelineName(): string {
        return 'DryRunCodeReviewPipeline';
    }
}
