export interface ICockpitMetricsVisibility {
    readonly summary: {
        readonly deployFrequency: boolean;
        readonly prCycleTime: boolean;
        readonly kodySuggestions: boolean;
        readonly bugRatio: boolean;
        readonly prSize: boolean;
    };
    readonly details: {
        readonly leadTimeBreakdown: boolean;
        readonly prCycleTime: boolean;
        readonly prsOpenedVsClosed: boolean;
        readonly prsMergedByDeveloper: boolean;
        readonly teamActivity: boolean;
    };
}

export const DEFAULT_COCKPIT_METRICS_VISIBILITY: ICockpitMetricsVisibility = {
    summary: {
        deployFrequency: true,
        prCycleTime: true,
        kodySuggestions: true,
        bugRatio: true,
        prSize: true,
    },
    details: {
        leadTimeBreakdown: true,
        prCycleTime: true,
        prsOpenedVsClosed: true,
        prsMergedByDeveloper: true,
        teamActivity: true,
    },
};
