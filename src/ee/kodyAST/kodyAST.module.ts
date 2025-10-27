import { Global, Module } from '@nestjs/common';
import { AST_ANALYSIS_SERVICE_TOKEN } from '@/core/domain/codeBase/contracts/ASTAnalysisService.contract';
import { CodeAstAnalysisService } from '@/ee/kodyAST/codeASTAnalysis.service';
import { PlatformIntegrationModule } from '@/modules/platformIntegration.module';
import { environment } from '../configs/environment';

const staticImports = [PlatformIntegrationModule];

const providers = [];
const moduleExports = [AST_ANALYSIS_SERVICE_TOKEN];

if (environment.API_CLOUD_MODE && process.env.API_ENABLE_CODE_REVIEW_AST) {
    providers.push({
        provide: AST_ANALYSIS_SERVICE_TOKEN,
        useClass: CodeAstAnalysisService,
    });
} else {
    // Self-hosted mode, provide null services
    providers.push({ provide: AST_ANALYSIS_SERVICE_TOKEN, useValue: null });
}

@Global()
@Module({
    imports: staticImports,
    providers,
    exports: moduleExports,
})
export class KodyASTModule {}
