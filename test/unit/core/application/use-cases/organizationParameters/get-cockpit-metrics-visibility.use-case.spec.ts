import { Test, TestingModule } from '@nestjs/testing';
import { 
    GetCockpitMetricsVisibilityUseCase,
    GET_COCKPIT_METRICS_VISIBILITY_USE_CASE_TOKEN
} from '@/core/application/use-cases/organizationParameters/get-cockpit-metrics-visibility.use-case';
import { ORGANIZATION_PARAMETERS_SERVICE_TOKEN } from '@/core/domain/organizationParameters/contracts/organizationParameters.service.contract';
import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { OrganizationParametersKey } from '@/shared/domain/enums/organization-parameters-key.enum';
import { DEFAULT_COCKPIT_METRICS_VISIBILITY, ICockpitMetricsVisibility } from '@/core/domain/organizationParameters/interfaces/cockpit-metrics-visibility.interface';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';

describe('GetCockpitMetricsVisibilityUseCase', () => {
    let useCase: GetCockpitMetricsVisibilityUseCase;
    let mockOrganizationParametersService: any;
    let mockLogger: any;

    const mockOrgData: OrganizationAndTeamData = {
        organizationId: 'org-123',
    };

    beforeEach(async () => {
        mockOrganizationParametersService = {
            findByKey: jest.fn(),
        };

        mockLogger = {
            log: jest.fn(),
            error: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: GET_COCKPIT_METRICS_VISIBILITY_USE_CASE_TOKEN,
                    useClass: GetCockpitMetricsVisibilityUseCase,
                },
                {
                    provide: ORGANIZATION_PARAMETERS_SERVICE_TOKEN,
                    useValue: mockOrganizationParametersService,
                },
                {
                    provide: PinoLoggerService,
                    useValue: mockLogger,
                },
            ],
        }).compile();

        useCase = module.get<GetCockpitMetricsVisibilityUseCase>(
            GET_COCKPIT_METRICS_VISIBILITY_USE_CASE_TOKEN,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('execute', () => {
        it('should return default visibility config when parameter not found', async () => {
            mockOrganizationParametersService.findByKey.mockResolvedValue(null);

            const result = await useCase.execute(mockOrgData);

            expect(result).toEqual(DEFAULT_COCKPIT_METRICS_VISIBILITY);
            expect(mockOrganizationParametersService.findByKey).toHaveBeenCalledWith(
                OrganizationParametersKey.COCKPIT_METRICS_VISIBILITY,
                mockOrgData,
            );
            expect(mockLogger.log).toHaveBeenCalledWith({
                message: 'Cockpit metrics visibility config not found, returning default values (all true)',
                context: GetCockpitMetricsVisibilityUseCase.name,
                metadata: {
                    organizationId: mockOrgData.organizationId,
                },
            });
        });

        it('should return custom visibility config when parameter exists', async () => {
            const customConfig: ICockpitMetricsVisibility = {
                summary: {
                    deployFrequency: true,
                    prCycleTime: false,
                    kodySuggestions: true,
                    bugRatio: false,
                    prSize: true,
                },
                details: {
                    leadTimeBreakdown: true,
                    prCycleTime: true,
                    prsOpenedVsClosed: false,
                    prsMergedByDeveloper: false,
                    teamActivity: true,
                },
            };

            mockOrganizationParametersService.findByKey.mockResolvedValue({
                uuid: 'param-uuid-123',
                configKey: OrganizationParametersKey.COCKPIT_METRICS_VISIBILITY,
                configValue: customConfig,
            });

            const result = await useCase.execute(mockOrgData);

            expect(result).toEqual(customConfig);
            expect(mockOrganizationParametersService.findByKey).toHaveBeenCalledWith(
                OrganizationParametersKey.COCKPIT_METRICS_VISIBILITY,
                mockOrgData,
            );
            expect(mockLogger.log).not.toHaveBeenCalled();
        });

        it('should return config with all metrics disabled when configured', async () => {
            const allDisabledConfig: ICockpitMetricsVisibility = {
                summary: {
                    deployFrequency: false,
                    prCycleTime: false,
                    kodySuggestions: false,
                    bugRatio: false,
                    prSize: false,
                },
                details: {
                    leadTimeBreakdown: false,
                    prCycleTime: false,
                    prsOpenedVsClosed: false,
                    prsMergedByDeveloper: false,
                    teamActivity: false,
                },
            };

            mockOrganizationParametersService.findByKey.mockResolvedValue({
                uuid: 'param-uuid-456',
                configKey: OrganizationParametersKey.COCKPIT_METRICS_VISIBILITY,
                configValue: allDisabledConfig,
            });

            const result = await useCase.execute(mockOrgData);

            expect(result).toEqual(allDisabledConfig);
            expect(result.summary.deployFrequency).toBe(false);
            expect(result.summary.prCycleTime).toBe(false);
            expect(result.details.leadTimeBreakdown).toBe(false);
        });

        it('should return default config on service error', async () => {
            mockOrganizationParametersService.findByKey.mockRejectedValue(
                new Error('Database connection error'),
            );

            const result = await useCase.execute(mockOrgData);

            expect(result).toEqual(DEFAULT_COCKPIT_METRICS_VISIBILITY);
            expect(mockLogger.error).toHaveBeenCalledWith({
                message: 'Error getting cockpit metrics visibility, returning default values',
                context: GetCockpitMetricsVisibilityUseCase.name,
                error: expect.any(Error),
                metadata: {
                    organizationAndTeamData: mockOrgData,
                },
            });
        });

        it('should work with organizationId and teamId', async () => {
            const orgDataWithTeam: OrganizationAndTeamData = {
                organizationId: 'org-123',
                teamId: 'team-456',
            };

            mockOrganizationParametersService.findByKey.mockResolvedValue(null);

            const result = await useCase.execute(orgDataWithTeam);

            expect(result).toEqual(DEFAULT_COCKPIT_METRICS_VISIBILITY);
            expect(mockOrganizationParametersService.findByKey).toHaveBeenCalledWith(
                OrganizationParametersKey.COCKPIT_METRICS_VISIBILITY,
                orgDataWithTeam,
            );
        });

        it('should ensure default config has all metrics enabled', () => {
            expect(DEFAULT_COCKPIT_METRICS_VISIBILITY.summary.deployFrequency).toBe(true);
            expect(DEFAULT_COCKPIT_METRICS_VISIBILITY.summary.prCycleTime).toBe(true);
            expect(DEFAULT_COCKPIT_METRICS_VISIBILITY.summary.kodySuggestions).toBe(true);
            expect(DEFAULT_COCKPIT_METRICS_VISIBILITY.summary.bugRatio).toBe(true);
            expect(DEFAULT_COCKPIT_METRICS_VISIBILITY.summary.prSize).toBe(true);
            expect(DEFAULT_COCKPIT_METRICS_VISIBILITY.details.leadTimeBreakdown).toBe(true);
            expect(DEFAULT_COCKPIT_METRICS_VISIBILITY.details.prCycleTime).toBe(true);
            expect(DEFAULT_COCKPIT_METRICS_VISIBILITY.details.prsOpenedVsClosed).toBe(true);
            expect(DEFAULT_COCKPIT_METRICS_VISIBILITY.details.prsMergedByDeveloper).toBe(true);
            expect(DEFAULT_COCKPIT_METRICS_VISIBILITY.details.teamActivity).toBe(true);
        });
    });
});

