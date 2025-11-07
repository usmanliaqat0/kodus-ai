import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { CoreDocument } from '@/shared/infrastructure/repositories/model/mongodb';
import {
    PromptSourceType,
    IFileReference,
    IPromptReferenceSyncError,
    PromptProcessingStatus,
} from '@/core/domain/prompts/interfaces/promptExternalReference.interface';

@Schema({ collection: 'promptExternalReferences', timestamps: true })
export class PromptExternalReferencesModel extends CoreDocument {
    @Prop({ required: true, index: true })
    public readonly configKey: string;

    @Prop({
        required: true,
        enum: Object.values(PromptSourceType),
        index: true,
    })
    public readonly sourceType: PromptSourceType;

    @Prop({ required: true, index: true })
    public readonly organizationId: string;

    @Prop({ required: true, index: true })
    public readonly repositoryId: string;

    @Prop({ required: false })
    public readonly directoryId?: string;

    @Prop({ required: false })
    public readonly kodyRuleId?: string;

    @Prop({ required: true })
    public readonly repositoryName: string;

    @Prop({ required: true })
    public promptHash: string;

    @Prop({ required: true, type: Array, default: [] })
    public references: IFileReference[];

    @Prop({ required: false, type: Array, default: [] })
    public syncErrors?: IPromptReferenceSyncError[];

    @Prop({
        required: true,
        enum: Object.values(PromptProcessingStatus),
        default: PromptProcessingStatus.PENDING,
        index: true,
    })
    public processingStatus: PromptProcessingStatus;

    @Prop({ required: true, default: () => new Date() })
    public lastProcessedAt: Date;
}

export const PromptExternalReferencesSchema = SchemaFactory.createForClass(
    PromptExternalReferencesModel,
);

PromptExternalReferencesSchema.index(
    { configKey: 1, sourceType: 1 },
    { unique: true },
);
PromptExternalReferencesSchema.index({ organizationId: 1, repositoryId: 1 });
PromptExternalReferencesSchema.index({ promptHash: 1 });
