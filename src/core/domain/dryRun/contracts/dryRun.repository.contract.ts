import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { DryRunEntity } from '../entities/dryRun.entity';
import { IDryRun } from '../interfaces/dryRun.interface';

export const DRY_RUN_REPOSITORY_TOKEN = Symbol('DRY_RUN_REPOSITORY_TOKEN');

export interface IDryRunRepository {
    create(
        dryRun: Omit<IDryRun, 'uuid' | 'createdAt' | 'updatedAt'>,
    ): Promise<DryRunEntity>;
    update(uuid: string, dryRun: Partial<IDryRun>): Promise<DryRunEntity>;
    findOne(filter: Partial<IDryRun>): Promise<DryRunEntity | null>;
    find(filter: Partial<IDryRun>): Promise<DryRunEntity[]>;
    delete(uuid: string): Promise<void>;
}
