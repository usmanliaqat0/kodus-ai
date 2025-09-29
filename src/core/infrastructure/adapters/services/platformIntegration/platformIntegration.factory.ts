import { ICodeManagementService } from '@/core/domain/platformIntegrations/interfaces/code-management.interface';
import { Injectable } from '@nestjs/common';

@Injectable()
export class PlatformIntegrationFactory {
    private codeManagementServices = new Map<string, ICodeManagementService>();

    registerCodeManagementService(
        type: string,
        service: ICodeManagementService,
    ) {
        this.codeManagementServices.set(type, service);
    }

    getCodeManagementService(type: string): ICodeManagementService {
        const service = this.codeManagementServices.get(type);

        if (!service) {
            throw new Error(`Repository service for type '${type}' not found.`);
        }
        return service;
    }
}
