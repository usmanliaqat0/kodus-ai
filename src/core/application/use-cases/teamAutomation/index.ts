import { GetTeamAutomationUseCase } from './getTeamAutomationUseCase';
import { ListAllTeamAutomationUseCase } from './listAllTeamAutomationUseCase';
import { UpdateTeamAutomationStatusUseCase } from './updateTeamAutomationStatusUseCase';
import { ActiveCodeManagementTeamAutomationsUseCase } from './active-code-manegement-automations.use-case';
import { ActiveCodeReviewAutomationUseCase } from './active-code-review-automation.use-case';

export const UseCases = [
    GetTeamAutomationUseCase,
    ListAllTeamAutomationUseCase,
    UpdateTeamAutomationStatusUseCase,
    ActiveCodeManagementTeamAutomationsUseCase,
    ActiveCodeReviewAutomationUseCase,
];
