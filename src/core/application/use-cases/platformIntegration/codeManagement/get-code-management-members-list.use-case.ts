import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { PullRequestHandlerService } from '@/core/infrastructure/adapters/services/codeBase/pullRequestManager.service';
import { PULL_REQUEST_MANAGER_SERVICE_TOKEN } from '@/core/domain/codeBase/contracts/PullRequestManagerService.contract';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';

@Injectable()
export class GetCodeManagementMemberListUseCase implements IUseCase {
    constructor(
        private readonly codeManagementService: CodeManagementService,
        @Inject(PULL_REQUEST_MANAGER_SERVICE_TOKEN)
        private readonly pullRequestHandlerService: PullRequestHandlerService,

        @Inject(REQUEST)
        private readonly request: Request & {
            user: { organization: { uuid: string } };
        },

        private readonly logger: PinoLoggerService,
    ) {}

    public async execute(): Promise<
        { name: string; id: string | number }[]
    > {
        const organizationAndTeamData: OrganizationAndTeamData = {
            organizationId: this.request.user.organization.uuid,
        };

        const platformMembers =
            await this.fetchMembersFromCodeIntegration(organizationAndTeamData);

        if (platformMembers.length > 0) {
            return platformMembers;
        }

        return await this.fetchMembersFromPullRequests(
            organizationAndTeamData,
        );
    }

    private async fetchMembersFromCodeIntegration(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<{ name: string; id: string | number }[]> {
        try {
            const members = await this.codeManagementService.getListMembers({
                organizationAndTeamData,
            });

            return this.normalizeMembers(members);
        } catch (error) {
            this.logger.warn({
                message: 'Unable to fetch members from code integration',
                context: GetCodeManagementMemberListUseCase.name,
                metadata: {
                    organizationId: organizationAndTeamData.organizationId,
                },
                error,
            });

            return [];
        }
    }

    private async fetchMembersFromPullRequests(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<{ name: string; id: string | number }[]> {
        try {
            const authors =
                await this.pullRequestHandlerService.getPullRequestAuthorsWithCache(
                    organizationAndTeamData,
                );

            const normalizedAuthors = (authors ?? []).map((author) => ({
                id: author?.id,
                name: author?.name,
            }));

            return this.normalizeMembers(normalizedAuthors);
        } catch (error) {
            this.logger.error({
                message: 'Unable to fetch members from pull requests fallback',
                context: GetCodeManagementMemberListUseCase.name,
                metadata: {
                    organizationId: organizationAndTeamData.organizationId,
                },
                error,
            });

            return [];
        }
    }

    private normalizeMembers(
        members: Array<{ name?: string; id?: string | number }> = [],
    ): { name: string; id: string | number }[] {
        if (!Array.isArray(members) || members.length === 0) {
            return [];
        }

        const uniqueMembers = new Map<
            string,
            { name: string; id: string | number }
        >();

        for (const member of members) {
            const normalized = this.normalizeMember(member);

            if (normalized && !uniqueMembers.has(String(normalized.id))) {
                uniqueMembers.set(String(normalized.id), normalized);
            }
        }

        return Array.from(uniqueMembers.values());
    }

    private normalizeMember(member: {
        name?: string;
        id?: string | number;
        [key: string]: any;
    }): { name: string; id: string | number } | null {
        if (!member) {
            return null;
        }

        const rawId =
            member?.descriptor ??
            member?.id ??
            member?.uuid ??
            member?.originId ??
            member?.email ??
            member?.login ??
            member?.principalName;

        const rawName =
            member?.name ??
            member?.displayName ??
            member?.login ??
            member?.principalName ??
            member?.email;

        if (!rawId || !rawName) {
            return null;
        }

        return {
            id: rawId,
            name: rawName,
        };
    }
}
