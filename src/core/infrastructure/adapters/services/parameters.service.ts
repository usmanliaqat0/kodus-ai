import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import {
    IParametersRepository,
    PARAMETERS_REPOSITORY_TOKEN,
} from '@/core/domain/parameters/contracts/parameters.repository.contracts';
import { IParametersService } from '@/core/domain/parameters/contracts/parameters.service.contract';
import { ParametersEntity } from '@/core/domain/parameters/entities/parameters.entity';
import { IParameters } from '@/core/domain/parameters/interfaces/parameters.interface';
import { ParametersKey } from '@/shared/domain/enums/parameters-key.enum';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ParametersService implements IParametersService {
    constructor(
        @Inject(PARAMETERS_REPOSITORY_TOKEN)
        private readonly parametersRepository: IParametersRepository,
    ) {}

    find<K extends ParametersKey>(
        filter?: Partial<IParameters<K>>,
    ): Promise<ParametersEntity<K>[]> {
        return this.parametersRepository.find(filter);
    }

    findOne<K extends ParametersKey>(
        filter?: Partial<IParameters<K>>,
    ): Promise<ParametersEntity<K>> {
        return this.parametersRepository.findOne(filter);
    }

    findByOrganizationName<K extends ParametersKey>(
        organizationName: string,
    ): Promise<ParametersEntity<K>> {
        return this.parametersRepository.findByOrganizationName(
            organizationName,
        );
    }
    findById<K extends ParametersKey>(
        uuid: string,
    ): Promise<ParametersEntity<K>> {
        return this.parametersRepository.findById(uuid);
    }

    create<K extends ParametersKey>(
        parameters: IParameters<K>,
    ): Promise<ParametersEntity<K>> {
        return this.parametersRepository.create(parameters);
    }

    update<K extends ParametersKey>(
        filter: Partial<IParameters<K>>,
        data: Partial<IParameters<K>>,
    ): Promise<ParametersEntity<K>> {
        return this.parametersRepository.update(filter, data);
    }

    delete(uuid: string): Promise<void> {
        return this.parametersRepository.delete(uuid);
    }

    async findByKey<K extends ParametersKey>(
        configKey: K,
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<ParametersEntity<K>> {
        return this.parametersRepository.findByKey(
            configKey,
            organizationAndTeamData,
        );
    }

    async createOrUpdateConfig<K extends ParametersKey>(
        parametersKey: K,
        configValue: ParametersEntity<K>['configValue'],
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<ParametersEntity<K> | boolean> {
        try {
            const teamId = organizationAndTeamData.teamId;

            const existingParameters = await this.findOne({
                team: { uuid: teamId },
                configKey: parametersKey,
                active: true,
            });

            const version = existingParameters
                ? existingParameters.version + 1
                : 1;

            if (parametersKey !== ParametersKey.CODE_REVIEW_CONFIG) {
                return existingParameters
                    ? this.updateExistingParameters(
                          existingParameters,
                          configValue,
                          teamId,
                      )
                    : this.createNewParameters(
                          parametersKey,
                          configValue,
                          teamId,
                          version,
                      );
            }

            if (existingParameters) {
                const disabled =
                    await this.disableExistingParameters(existingParameters);

                if (!disabled) {
                    throw new Error(
                        'Error disabling existing code review config parameters',
                    );
                }
            }

            return this.createNewParameters(
                parametersKey,
                configValue,
                teamId,
                version,
            );
        } catch (err) {
            throw new BadRequestException(err);
        }
    }

    private async disableExistingParameters<K extends ParametersKey>(
        existingParameters: ParametersEntity<K>,
    ): Promise<boolean> {
        await this.update(
            {
                uuid: existingParameters.uuid,
            },
            {
                active: false,
            },
        );
        return true;
    }

    private async updateExistingParameters<K extends ParametersKey>(
        existingParameters: ParametersEntity<K>,
        configValue: ParametersEntity<K>['configValue'],
        teamId: string,
    ): Promise<boolean> {
        await this.update(
            {
                uuid: existingParameters.uuid,
                team: { uuid: teamId },
            },
            {
                configKey: existingParameters.configKey,
                configValue,
                team: { uuid: teamId },
            },
        );
        return true;
    }

    private async createNewParameters<K extends ParametersKey>(
        parametersKey: K,
        configValue: ParametersEntity<K>['configValue'],
        teamId: string,
        version: number,
    ): Promise<ParametersEntity<K>> {
        return this.create({
            uuid: uuidv4(),
            configKey: parametersKey,
            configValue,
            team: { uuid: teamId },
            active: true,
            version,
        });
    }
}
