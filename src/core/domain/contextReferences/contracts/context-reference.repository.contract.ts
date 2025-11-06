import { ContextReferenceEntity } from '../entities/context-reference.entity';
import { IContextReference } from '../interfaces/context-reference.interface';

export const CONTEXT_REFERENCE_REPOSITORY_TOKEN = Symbol(
    'ContextReferenceRepository',
);

export interface IContextReferenceRepository {
    create(
        contextReference: IContextReference,
    ): Promise<ContextReferenceEntity | undefined>;

    find(
        filter?: Partial<IContextReference>,
    ): Promise<ContextReferenceEntity[]>;

    findOne(
        filter: Partial<IContextReference>,
    ): Promise<ContextReferenceEntity | undefined>;

    findById(uuid: string): Promise<ContextReferenceEntity | undefined>;

    update(
        filter: Partial<IContextReference>,
        data: Partial<IContextReference>,
    ): Promise<ContextReferenceEntity | undefined>;

    delete(uuid: string): Promise<void>;
}
