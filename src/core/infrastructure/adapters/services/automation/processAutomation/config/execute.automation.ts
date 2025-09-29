import { IExecuteAutomationService } from '@/shared/domain/contracts/execute.automation.service.contracts';
import { Injectable } from '@nestjs/common';
import { AutomationRegistry } from './register.automation';

@Injectable()
export class ExecuteAutomationService implements IExecuteAutomationService {
    constructor(private readonly automationRegistry: AutomationRegistry) {}

    async executeStrategy(name: string, payload: any): Promise<any> {
        const strategy = this.automationRegistry.getStrategy(name);
        return await strategy.run(payload);
    }

    async setupStrategy(name: string, payload: any): Promise<any> {
        const strategy = this.automationRegistry.getStrategy(name);
        return await strategy.setup(payload);
    }

    async stopStrategy(name: string, payload: any): Promise<any> {
        const strategy = this.automationRegistry.getStrategy(name);
        return await strategy.stop(payload);
    }

    async getAutomationMethods(name: string): Promise<any> {
        return this.automationRegistry.getStrategy(name);
    }
}
