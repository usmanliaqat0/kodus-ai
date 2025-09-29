import { forwardRef, Module } from '@nestjs/common';

import { CodebaseModule } from '@/modules/codeBase.module';
import { KODY_FINE_TUNING_CONTEXT_PREPARATION_TOKEN } from '@/shared/interfaces/kody-fine-tuning-context-preparation.interface';
import { LogModule } from '@/modules/log.module';
import { KodyFineTuningContextPreparationService } from '@/core/infrastructure/adapters/services/kodyFineTuning/fine-tuning.service';

@Module({
    imports: [forwardRef(() => CodebaseModule), LogModule],
    providers: [
        {
            provide: KODY_FINE_TUNING_CONTEXT_PREPARATION_TOKEN,
            useClass: KodyFineTuningContextPreparationService,
        },
    ],
    exports: [KODY_FINE_TUNING_CONTEXT_PREPARATION_TOKEN],
})
export class KodyFineTuningContextModule {}
