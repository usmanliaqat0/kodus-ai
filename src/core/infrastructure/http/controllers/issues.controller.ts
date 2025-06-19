import {
    Controller,
    Get,
    Param,
    Query,
} from '@nestjs/common';
import { GetIssuesByFiltersDto } from '../dtos/get-issues-by-filters.dto';
import { GetIssuesByFiltersUseCase } from '@/core/application/use-cases/issues/get-issues-by-filters.use-case';
import { GetIssueByIdUseCase } from '@/core/application/use-cases/issues/get-issue-by-id.use-case';

@Controller('issues')
export class IssuesController {
    constructor(
        private readonly getIssuesByFiltersUseCase: GetIssuesByFiltersUseCase,
        private readonly getIssueByIdUseCase: GetIssueByIdUseCase,
    ) {}

    @Get()
    async getIssues(@Query() query: GetIssuesByFiltersDto) {
        return this.getIssuesByFiltersUseCase.execute(query);
    }

    @Get(':id')
    async getIssueById(@Param('id') id: string) {
        return await this.getIssueByIdUseCase.execute(id);
    }
}