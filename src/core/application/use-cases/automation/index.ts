import { RunCodeReviewAutomationUseCase } from '@/ee/automation/runCodeReview.use-case';
import { GetAllAutomationsUseCase } from './get-all-automations.use-case';
import { getAllAutomationExecutionsUseCase } from './get-all-executions.use-case';

export const UseCases = [
    GetAllAutomationsUseCase,
    RunCodeReviewAutomationUseCase,
    getAllAutomationExecutionsUseCase,
];
