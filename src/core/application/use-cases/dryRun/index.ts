import { ExecuteDryRunUseCase } from './execute-dry-run.use-case';
import { GetDryRunUseCase } from './get-dry-run.use-case';
import { GetStatusDryRunUseCase } from './get-status-dry-run.use-case';
import { ListDryRunsUseCase } from './list-dry-runs.use-case';
import { SseDryRunUseCase } from './sse-dry-run.use-case';

export const UseCases = [
    ExecuteDryRunUseCase,
    GetStatusDryRunUseCase,
    SseDryRunUseCase,
    GetDryRunUseCase,
    ListDryRunsUseCase,
];
