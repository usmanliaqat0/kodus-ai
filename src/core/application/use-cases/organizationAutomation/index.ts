import { ActiveOrganizationAutomationsUseCase } from './activeOrganizationAutomationsUseCase';
import { GetOrganizationAutomationUseCase } from './getOrganizationAutomationUseCase';
import { UpdateOrCreateOrganizationAutomationUseCase } from './updateOrCreateOrganizationAutomationUseCase';

export const UseCases = [
    GetOrganizationAutomationUseCase,
    ActiveOrganizationAutomationsUseCase,
    UpdateOrCreateOrganizationAutomationUseCase,
];
