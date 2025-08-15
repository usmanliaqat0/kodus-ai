/**
 * @module core/storage/adapters/in-memory-adapter
 * @description In-memory storage adapter for development and testing
 */

import { StorageType } from '../../types/storage-types.js';
import { createLogger } from '../../../observability/logger.js';
import type {
    BaseStorage,
    BaseStorageItem,
    BaseStorageStats,
} from '../../types/base-storage.js';
import type { StorageAdapterConfig } from '../factory.js';

const logger = createLogger('in-memory-storage-adapter');

/**
 * In-memory storage adapter
 * Stores items in a Map in memory
 */
export class InMemoryStorageAdapter<T extends BaseStorageItem>
    implements BaseStorage<T>
{
    private items: Map<string, T> = new Map();
    private config: StorageAdapterConfig;
    private isInitialized = false;

    constructor(config: StorageAdapterConfig) {
        this.config = config;
    }

    /**
     * Initialize the adapter
     */
    initialize(): Promise<void> {
        if (this.isInitialized) {
            return Promise.resolve();
        }

        // Start cleanup interval
        this.startCleanupInterval();

        this.isInitialized = true;
        logger.info('InMemoryStorageAdapter initialized', {
            maxItems: this.config.maxItems,
            enableCompression: this.config.enableCompression,
        });

        return Promise.resolve();
    }

    /**
     * Store an item
     */
    async store(item: T): Promise<void> {
        await this.ensureInitialized();

        // Check if we need to remove old items
        if (this.items.size >= this.config.maxItems) {
            this.removeOldestItems();
        }

        this.items.set(item.id, item);

        logger.debug('Item stored', {
            id: item.id,
            totalItems: this.items.size,
        });

        return Promise.resolve();
    }

    /**
     * Retrieve an item by ID
     */
    async retrieve(id: string): Promise<T | null> {
        await this.ensureInitialized();

        const item = this.items.get(id);
        if (!item) {
            return Promise.resolve(null);
        }

        // Check if item has expired
        if (
            item.metadata?.expireAt &&
            typeof item.metadata.expireAt === 'number' &&
            Date.now() > item.metadata.expireAt
        ) {
            await this.delete(id);
            return Promise.resolve(null);
        }

        return Promise.resolve(item);
    }

    /**
     * Delete an item by ID
     */
    async delete(id: string): Promise<boolean> {
        await this.ensureInitialized();

        const deleted = this.items.delete(id);

        if (deleted) {
            logger.debug('Item deleted', { id });
        }

        return Promise.resolve(deleted);
    }

    /**
     * Clear all items
     */
    async clear(): Promise<void> {
        await this.ensureInitialized();

        this.items.clear();
        logger.info('All items cleared');

        return Promise.resolve();
    }

    /**
     * Get storage statistics
     */
    async getStats(): Promise<BaseStorageStats> {
        await this.ensureInitialized();

        const items = Array.from(this.items.values());
        const totalSize = items.reduce((size, item) => {
            return size + JSON.stringify(item).length;
        }, 0);

        return Promise.resolve({
            itemCount: this.items.size,
            totalSize,
            averageItemSize:
                this.items.size > 0 ? totalSize / this.items.size : 0,
            adapterType: StorageType.INMEMORY,
        });
    }

    /**
     * Check if adapter is healthy
     */
    isHealthy(): Promise<boolean> {
        return Promise.resolve(this.isInitialized);
    }

    /**
     * Cleanup resources
     */
    cleanup(): Promise<void> {
        this.items.clear();
        this.isInitialized = false;
        logger.info('InMemoryStorageAdapter cleaned up');
        return Promise.resolve();
    }

    /**
     * Ensure adapter is initialized
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        return Promise.resolve();
    }

    /**
     * Start cleanup interval
     */
    private startCleanupInterval(): void {
        if (this.config.cleanupInterval > 0) {
            setInterval(() => {
                this.cleanupExpiredItems();
            }, this.config.cleanupInterval);
        }
    }

    /**
     * Remove oldest items when limit is reached
     */
    private removeOldestItems(): void {
        const items = Array.from(this.items.entries());

        // Sort by timestamp (oldest first)
        items.sort(([, a], [, b]) => a.timestamp - b.timestamp);

        // Remove oldest items
        const toRemove = items.slice(0, Math.floor(this.config.maxItems * 0.1)); // Remove 10%

        for (const [id] of toRemove) {
            this.items.delete(id);
        }

        logger.debug('Removed oldest items', {
            removedCount: toRemove.length,
            remainingCount: this.items.size,
        });
    }

    /**
     * Cleanup expired items
     */
    private cleanupExpiredItems(): void {
        const now = Date.now();
        let expiredCount = 0;

        for (const [id, item] of this.items.entries()) {
            if (
                item.metadata?.expireAt &&
                typeof item.metadata.expireAt === 'number' &&
                now > item.metadata.expireAt
            ) {
                this.items.delete(id);
                expiredCount++;
            }
        }

        if (expiredCount > 0) {
            logger.debug('Cleaned up expired items', {
                expiredCount,
                remainingCount: this.items.size,
            });
        }
    }

    /**
     * Get all items (for testing/debugging)
     */
    getAllItems(): Map<string, T> {
        return new Map(this.items);
    }
}
