import { Entity } from '@/shared/domain/interfaces/entity';
import { IDryRun } from '../interfaces/dryRun.interface';

export class DryRunEntity implements Entity<IDryRun> {
    private readonly _uuid: string;
    private readonly _createdAt: Date;
    private readonly _updatedAt: Date;
    private readonly _organizationId: string;
    private readonly _teamId: string;
    private readonly _runs: IDryRun['runs'];

    constructor(dryRun: IDryRun) {
        this._uuid = dryRun.uuid;
        this._createdAt = dryRun.createdAt;
        this._updatedAt = dryRun.updatedAt;
        this._organizationId = dryRun.organizationId;
        this._teamId = dryRun.teamId;
        this._runs = dryRun.runs;
    }

    toObject(): IDryRun {
        return {
            uuid: this.uuid,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            organizationId: this.organizationId,
            teamId: this.teamId,
            runs: this.runs,
        };
    }

    toJson(): IDryRun | Partial<IDryRun> {
        return this.toObject();
    }

    public static create(dryRun: IDryRun): DryRunEntity {
        return new DryRunEntity(dryRun);
    }

    get uuid(): string {
        return this._uuid;
    }

    get createdAt(): Date {
        return this._createdAt;
    }

    get updatedAt(): Date {
        return this._updatedAt;
    }

    get organizationId(): string {
        return this._organizationId;
    }

    get teamId(): string {
        return this._teamId;
    }

    get runs(): IDryRun['runs'] {
        return [...this._runs];
    }
}
