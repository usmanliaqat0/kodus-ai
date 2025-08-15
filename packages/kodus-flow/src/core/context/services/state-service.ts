/**
 * State Service Implementation
 *
 * Provides namespaced state management with WeakMap-based isolation
 * Implements the StateManager interface from thread-safe-state.ts
 */

import type { StateManager } from '../../../utils/thread-safe-state.js';

/**
 * Context-based state service using WeakMap for automatic cleanup
 */
export class ContextStateService<T> implements StateManager<T> {
    private readonly stateMap = new WeakMap<
        object,
        Map<string, Map<string, T>>
    >();
    private readonly maxNamespaceSize: number;
    private readonly maxNamespaces: number;

    constructor(
        private readonly contextKey: object,
        options: {
            maxNamespaceSize?: number;
            maxNamespaces?: number;
        } = {},
    ) {
        this.maxNamespaceSize = options.maxNamespaceSize ?? 1000; // Prevent namespace from growing too large
        this.maxNamespaces = options.maxNamespaces ?? 100; // Prevent too many namespaces
    }

    /**
     * Get a value from a specific namespace
     */
    get(namespace: string, key: string): Promise<T | undefined> {
        const namespaces = this.stateMap.get(this.contextKey);

        if (!namespaces) {
            return Promise.resolve(undefined);
        }

        const namespaceMap = namespaces.get(namespace);
        if (!namespaceMap) {
            return Promise.resolve(undefined);
        }

        const value = namespaceMap.get(key);

        return Promise.resolve(value);
    }

    /**
     * Set a value in a specific namespace
     */
    set(namespace: string, key: string, value: T): Promise<void> {
        // Validate inputs for security
        if (!namespace || typeof namespace !== 'string') {
            throw new Error('Namespace must be a non-empty string');
        }
        if (!key || typeof key !== 'string') {
            throw new Error('Key must be a non-empty string');
        }

        // CRÍTICO: Operação atômica para evitar race conditions
        let namespaces = this.stateMap.get(this.contextKey);

        if (!namespaces) {
            namespaces = new Map();
            this.stateMap.set(this.contextKey, namespaces);
        }

        // Check namespace limit ANTES de criar novo namespace
        if (
            !namespaces.has(namespace) &&
            namespaces.size >= this.maxNamespaces
        ) {
            throw new Error(
                `Maximum number of namespaces (${this.maxNamespaces.toString()}) exceeded`,
            );
        }

        let namespaceMap = namespaces.get(namespace);

        if (!namespaceMap) {
            namespaceMap = new Map();
            namespaces.set(namespace, namespaceMap);
        }

        // Check namespace size limit ANTES de adicionar nova key
        if (
            !namespaceMap.has(key) &&
            namespaceMap.size >= this.maxNamespaceSize
        ) {
            throw new Error(
                `Maximum namespace size (${this.maxNamespaceSize.toString()}) exceeded for namespace '${namespace}'`,
            );
        }

        namespaceMap.set(key, value);

        return Promise.resolve();
    }

    /**
     * Delete a specific key from a namespace
     */
    delete(namespace: string, key: string): Promise<boolean> {
        const namespaces = this.stateMap.get(this.contextKey);

        if (!namespaces) {
            return Promise.resolve(false);
        }

        const namespaceMap = namespaces.get(namespace);

        if (!namespaceMap) {
            return Promise.resolve(false);
        }

        return Promise.resolve(namespaceMap.delete(key));
    }

    /**
     * Clear all keys in a namespace, or all namespaces if none specified
     */
    clear(namespace?: string): Promise<void> {
        const namespaces = this.stateMap.get(this.contextKey);

        if (!namespaces) {
            return Promise.resolve();
        }

        if (namespace) {
            const namespaceMap = namespaces.get(namespace);
            if (namespaceMap) {
                namespaceMap.clear();
            }
        } else {
            namespaces.clear();
        }

        return Promise.resolve();
    }

    /**
     * Check if a key exists in a namespace
     */
    has(namespace: string, key: string): Promise<boolean> {
        const namespaces = this.stateMap.get(this.contextKey);
        if (!namespaces) {
            return Promise.resolve(false);
        }

        const namespaceMap = namespaces.get(namespace);
        if (!namespaceMap) {
            return Promise.resolve(false);
        }

        return Promise.resolve(namespaceMap.has(key));
    }

    /**
     * Get all keys in a namespace (required by StateManager interface)
     */
    keys(namespace: string): Promise<string[]> {
        const namespaces = this.stateMap.get(this.contextKey);
        if (!namespaces) {
            return Promise.resolve([]);
        }

        const namespaceMap = namespaces.get(namespace);
        if (!namespaceMap) {
            return Promise.resolve([]);
        }

        return Promise.resolve(Array.from(namespaceMap.keys()));
    }

    /**
     * Get size of a namespace or total size (required by StateManager interface)
     */
    size(namespace?: string): Promise<number> {
        const namespaces = this.stateMap.get(this.contextKey);
        if (!namespaces) {
            return Promise.resolve(0);
        }

        if (namespace) {
            const namespaceMap = namespaces.get(namespace);
            return Promise.resolve(namespaceMap ? namespaceMap.size : 0);
        } else {
            let total = 0;
            for (const namespaceMap of namespaces.values()) {
                total += namespaceMap.size;
            }
            return Promise.resolve(total);
        }
    }

    /**
     * Get all data from a specific namespace
     */
    getNamespace(namespace: string): Record<string, unknown> {
        const namespaces = this.stateMap.get(this.contextKey);

        if (!namespaces) {
            return {};
        }

        const namespaceMap = namespaces.get(namespace);
        if (!namespaceMap) {
            return {};
        }

        const result: Record<string, unknown> = {};
        for (const [key, value] of namespaceMap) {
            result[key] = value;
        }

        return result;
    }

    /**
     * Get all namespaces and their data
     */
    getAllNamespaces(): Record<string, Record<string, unknown>> {
        const namespaces = this.stateMap.get(this.contextKey);

        if (!namespaces) {
            return {};
        }

        const result: Record<string, Record<string, unknown>> = {};
        for (const [namespace, namespaceMap] of namespaces) {
            result[namespace] = {};

            for (const [key, value] of namespaceMap) {
                result[namespace][key] = value;
            }
        }

        return result;
    }

    /**
     * Check if a namespace exists
     */
    hasNamespace(namespace: string): boolean {
        const namespaces = this.stateMap.get(this.contextKey);

        if (!namespaces) {
            return false;
        }

        return namespaces.has(namespace);
    }

    /**
     * Get size of a namespace
     */
    getNamespaceSize(namespace: string): number {
        const namespaces = this.stateMap.get(this.contextKey);
        if (!namespaces) {
            return 0;
        }

        const namespaceMap = namespaces.get(namespace);
        if (!namespaceMap) {
            return 0;
        }

        return namespaceMap.size;
    }

    /**
     * List all namespace names
     */
    getNamespaceNames(): string[] {
        const namespaces = this.stateMap.get(this.contextKey);

        if (!namespaces) {
            return [];
        }

        return Array.from(namespaces.keys());
    }
}

/**
 * Global state service using a global key for shared state
 */
export class GlobalStateService implements StateManager<unknown> {
    private static readonly globalState = new Map<
        string,
        Map<string, unknown>
    >();

    get(namespace: string, key: string): Promise<unknown> {
        const namespaceMap = GlobalStateService.globalState.get(namespace);

        if (!namespaceMap) {
            return Promise.resolve(undefined);
        }

        return Promise.resolve(namespaceMap.get(key));
    }

    set(namespace: string, key: string, value: unknown): Promise<void> {
        let namespaceMap = GlobalStateService.globalState.get(namespace);

        if (!namespaceMap) {
            namespaceMap = new Map();
            GlobalStateService.globalState.set(namespace, namespaceMap);
        }

        namespaceMap.set(key, value);
        return Promise.resolve();
    }

    delete(namespace: string, key: string): Promise<boolean> {
        const namespaceMap = GlobalStateService.globalState.get(namespace);

        if (!namespaceMap) {
            return Promise.resolve(false);
        }

        return Promise.resolve(namespaceMap.delete(key));
    }

    clear(namespace?: string): Promise<void> {
        if (namespace) {
            const namespaceMap = GlobalStateService.globalState.get(namespace);

            if (namespaceMap) {
                namespaceMap.clear();
            }
        } else {
            GlobalStateService.globalState.clear();
        }

        return Promise.resolve();
    }

    has(namespace: string, key: string): Promise<boolean> {
        const namespaceMap = GlobalStateService.globalState.get(namespace);
        return Promise.resolve(namespaceMap ? namespaceMap.has(key) : false);
    }

    keys(namespace: string): Promise<string[]> {
        const namespaceMap = GlobalStateService.globalState.get(namespace);
        return Promise.resolve(
            namespaceMap ? Array.from(namespaceMap.keys()) : [],
        );
    }

    size(namespace?: string): Promise<number> {
        if (namespace) {
            const namespaceMap = GlobalStateService.globalState.get(namespace);
            return Promise.resolve(namespaceMap ? namespaceMap.size : 0);
        } else {
            let total = 0;
            for (const namespaceMap of GlobalStateService.globalState.values()) {
                total += namespaceMap.size;
            }
            return Promise.resolve(total);
        }
    }

    getNamespace(namespace: string): Record<string, unknown> {
        const namespaceMap = GlobalStateService.globalState.get(namespace);

        if (!namespaceMap) {
            return {};
        }

        const result: Record<string, unknown> = {};
        for (const [key, value] of namespaceMap) {
            result[key] = value;
        }

        return result;
    }
}

/**
 * Factory function to create a state service for a specific context
 */
export function createStateService<T>(
    contextKey: object,
    options?: {
        maxNamespaceSize?: number;
        maxNamespaces?: number;
    },
): StateManager<T> {
    return new ContextStateService<T>(contextKey, options);
}

/**
 * Factory function to create a global state service
 */
export function createGlobalStateService(): StateManager<unknown> {
    return new GlobalStateService();
}
