/**
 * @module core/storage/adapters/mongodb-adapter
 * @description MongoDB storage adapter implementation
 * @ts-nocheck - MongoDB types are dynamic
 * @eslint-disable @typescript-eslint/no-explicit-any
 * @eslint-disable @typescript-eslint/naming-convention
 */

import { createLogger } from '../../../observability/logger.js';
import type {
    BaseStorage,
    BaseStorageItem,
    BaseStorageStats,
} from '../../types/base-storage.js';
import type { StorageAdapterConfig } from '../factory.js';
import { MongoClient, Db, Collection } from 'mongodb';

const logger = createLogger('mongodb-storage-adapter');

/**
 * MongoDB storage adapter implementation
 */
export class MongoDBStorageAdapter<T extends BaseStorageItem>
    implements BaseStorage<T>
{
    private config: StorageAdapterConfig;
    private isInitialized = false;
    private client: MongoClient | null = null;
    private db: Db | null = null;
    private collection: Collection | null = null;

    constructor(config: StorageAdapterConfig) {
        this.config = config;
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            const connectionString =
                this.config.connectionString ??
                'mongodb://localhost:27017/kodus';
            const options = this.config.options ?? {};

            const maxPoolSize =
                typeof options.maxPoolSize === 'number'
                    ? options.maxPoolSize
                    : 10;
            const serverSelectionTimeoutMS =
                typeof options.serverSelectionTimeoutMS === 'number'
                    ? options.serverSelectionTimeoutMS
                    : 5000;
            const connectTimeoutMS =
                typeof options.connectTimeoutMS === 'number'
                    ? options.connectTimeoutMS
                    : 10000;
            const socketTimeoutMS =
                typeof options.socketTimeoutMS === 'number'
                    ? options.socketTimeoutMS
                    : 45000;

            this.client = new MongoClient(connectionString, {
                maxPoolSize,
                serverSelectionTimeoutMS,
                connectTimeoutMS,
                socketTimeoutMS,
            });

            await this.client.connect();

            const database =
                (options.database as string | undefined) ?? 'kodus';

            // ✅ NOVO: Determinar collection baseado no tipo de dados
            const defaultCollection =
                (options.collection as string | undefined) ?? 'storage';
            const dataType = this.determineDataType();
            const collection = this.getCollectionName(
                defaultCollection,
                dataType,
            );

            this.db = this.client.db(database);
            this.collection = this.db.collection(collection);

            // Create indexes for performance
            await (
                this.collection as {
                    createIndex: (
                        index: unknown,
                        options?: unknown,
                    ) => Promise<unknown>;
                }
            ).createIndex({ id: 1 }, { unique: true });
            await (
                this.collection as {
                    createIndex: (
                        index: unknown,
                        options?: unknown,
                    ) => Promise<unknown>;
                }
            ).createIndex({ timestamp: 1 });
            await (
                this.collection as {
                    createIndex: (
                        index: unknown,
                        options?: unknown,
                    ) => Promise<unknown>;
                }
            ).createIndex({ ['metadata.xcId']: 1 } as {
                [key: string]: number;
            });

            // Create TTL index if TTL is configured
            if (options.ttl) {
                await (
                    this.collection as {
                        createIndex: (
                            index: unknown,
                            options?: unknown,
                        ) => Promise<unknown>;
                    }
                ).createIndex(
                    { createdAt: 1 },
                    { expireAfterSeconds: options.ttl },
                );
            }

            this.isInitialized = true;
            logger.info('MongoDBStorageAdapter initialized', {
                database,
                collection,
                dataType,
                maxItems: this.config.maxItems,
                enableCompression: this.config.enableCompression,
                timeout: this.config.timeout,
            });
        } catch (error) {
            logger.error(
                'Failed to initialize MongoDB adapter',
                error as Error,
            );
            throw error;
        }
    }

    // ✅ NOVO: Determinar tipo de dados baseado no item
    private determineDataType(): string {
        // Se não temos dados de exemplo, usar padrão
        return 'storage';
    }

    // ✅ NOVO: Gerar nome da collection baseado no tipo
    private getCollectionName(
        defaultCollection: string,
        dataType: string,
    ): string {
        // Se a collection já tem prefixo kodus-, usar como está
        if (defaultCollection.startsWith('kodus-')) {
            return defaultCollection;
        }

        // Caso contrário, adicionar prefixo baseado no tipo
        switch (dataType) {
            case 'snapshots':
                return 'kodus-snapshots';
            case 'memory':
                return 'kodus-memory';
            case 'sessions':
                return 'kodus-sessions';
            case 'state':
                return 'kodus-state';
            default:
                return `kodus-${defaultCollection}`;
        }
    }

    async store(item: T): Promise<void> {
        await this.ensureInitialized();

        try {
            if (!this.collection) {
                throw new Error('Collection not initialized');
            }

            // ✅ CORRIGIDO: Estrutura limpa sem duplicação
            const document = {
                ...item,
                createdAt: new Date(),
            };

            await this.collection.replaceOne({ id: item.id }, document, {
                upsert: true,
            });

            logger.debug('Item stored in MongoDB', {
                id: item.id,
                timestamp: item.timestamp,
                collection: this.collection.collectionName,
            });
        } catch (error) {
            logger.error('Failed to store item in MongoDB', error as Error, {
                id: item.id,
                collection: this.collection?.collectionName,
            });
            throw error;
        }
    }

    async retrieve(id: string): Promise<T | null> {
        await this.ensureInitialized();

        try {
            const document = await this.collection?.findOne({ id });

            if (!document) {
                return null;
            }

            // ✅ CORRIGIDO: Retornar documento completo (sem campo data)
            return document as unknown as T;
        } catch (error) {
            logger.error(
                'Failed to retrieve item from MongoDB',
                error as Error,
                {
                    id,
                    collection: this.collection?.collectionName,
                },
            );
            throw error;
        }
    }

    async delete(id: string): Promise<boolean> {
        await this.ensureInitialized();

        try {
            const result = await this.collection?.deleteOne({ id });

            logger.debug('Item deleted from MongoDB', {
                id,
                deletedCount: result?.deletedCount ?? 0,
                collection: this.collection?.collectionName,
            });

            return (result?.deletedCount ?? 0) > 0;
        } catch (error) {
            logger.error('Failed to delete item from MongoDB', error as Error, {
                id,
                collection: this.collection?.collectionName,
            });
            throw error;
        }
    }

    async clear(): Promise<void> {
        await this.ensureInitialized();

        try {
            await this.collection?.deleteMany({});

            logger.info('Collection cleared', {
                collection: this.collection?.collectionName,
            });
        } catch (error) {
            logger.error('Failed to clear collection', error as Error, {
                collection: this.collection?.collectionName,
            });
            throw error;
        }
    }

    async getStats(): Promise<BaseStorageStats> {
        await this.ensureInitialized();

        try {
            const count = await this.collection?.countDocuments();
            const stats = await this.collection
                ?.aggregate([
                    {
                        $group: {
                            _id: null, // eslint-disable-line @typescript-eslint/naming-convention
                            totalSize: { $sum: { $bsonSize: '$$ROOT' } },
                            avgSize: { $avg: { $bsonSize: '$$ROOT' } },
                        },
                    },
                ])
                .toArray();

            const result = stats?.[0] ?? { totalSize: 0, avgSize: 0 };

            return {
                itemCount: count ?? 0,
                totalSize: (result.totalSize as number | undefined) ?? 0,
                averageItemSize: Math.round(
                    (result.avgSize as number | undefined) ?? 0,
                ),
                adapterType: 'mongodb',
            };
        } catch (error) {
            logger.error('Failed to get stats from MongoDB', error as Error, {
                collection: this.collection?.collectionName,
            });
            throw error;
        }
    }

    async isHealthy(): Promise<boolean> {
        try {
            if (!this.client) {
                return false;
            }

            // Ping the database
            await this.client.db().admin().ping();
            return true;
        } catch (error) {
            logger.error('Health check failed', error as Error);
            return false;
        }
    }

    async cleanup(): Promise<void> {
        try {
            if (this.client) {
                await this.client.close();
                this.client = null;
                this.db = null;
                this.collection = null;
                this.isInitialized = false;

                logger.info('MongoDB adapter cleaned up');
            }
        } catch (error) {
            logger.error('Failed to cleanup MongoDB adapter', error as Error);
            throw error;
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    /**
     * Find one document by arbitrary query (used by higher-level adapters when needed)
     */
    async findOneByQuery(query: Record<string, unknown>): Promise<T | null> {
        await this.ensureInitialized();
        try {
            const doc = await this.collection?.findOne(
                query as unknown as object,
            );

            if (!doc) {
                return null;
            }

            return doc as unknown as T;
        } catch (error) {
            logger.error('Failed to execute findOneByQuery', error as Error, {
                query,
            });
            return null;
        }
    }
}
