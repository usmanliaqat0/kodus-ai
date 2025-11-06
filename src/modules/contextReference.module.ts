import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContextReferenceModel } from '@/core/infrastructure/adapters/repositories/typeorm/schema/contextReference.model';
import { ContextReferenceRepository } from '@/core/infrastructure/adapters/repositories/typeorm/contextReference.repository';
import { CONTEXT_REFERENCE_REPOSITORY_TOKEN } from '@/core/domain/contextReferences/contracts/context-reference.repository.contract';
import { ContextReferenceService } from '@/core/infrastructure/adapters/services/context/context-reference.service';
import { ContextReferenceDetectionService } from '@/core/infrastructure/adapters/services/context/context-reference-detection.service';
import { CodeReviewContextPackService } from '@/core/infrastructure/adapters/services/context/code-review-context-pack.service';
import { CONTEXT_REFERENCE_SERVICE_TOKEN } from '@/core/domain/contextReferences/contracts/context-reference.service.contract';
import { MCPToolArgResolverAgentService } from '@/core/infrastructure/adapters/services/context/mcp-tool-arg-resolver-agent.service';
import { MCPToolMetadataService } from '@/core/infrastructure/adapters/mcp/services/mcp-tool-metadata.service';
import { PermissionValidationModule } from '@/ee/shared/permission-validation.module';
import { PromptsModule } from './prompts.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([ContextReferenceModel]),
        PermissionValidationModule,
        forwardRef(() => PromptsModule),
    ],
    providers: [
        ContextReferenceService,
        ContextReferenceDetectionService,
        CodeReviewContextPackService,
        MCPToolArgResolverAgentService,
        MCPToolMetadataService,
        {
            provide: CONTEXT_REFERENCE_SERVICE_TOKEN,
            useExisting: ContextReferenceService,
        },
        {
            provide: CONTEXT_REFERENCE_REPOSITORY_TOKEN,
            useClass: ContextReferenceRepository,
        },
    ],
    exports: [
        ContextReferenceService,
        ContextReferenceDetectionService,
        CodeReviewContextPackService,
        MCPToolArgResolverAgentService,
        MCPToolMetadataService,
        CONTEXT_REFERENCE_SERVICE_TOKEN,
        CONTEXT_REFERENCE_REPOSITORY_TOKEN,
    ],
})
export class ContextReferenceModule {}
