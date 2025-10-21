import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCriticalIndexes1729876543210 implements MigrationInterface {
    // CRITICAL: Disable transactions for CONCURRENT index creation
    public transaction = false;

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Parameters table indexes
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_parameters_key_team_active" ON "parameters" ("key", "team_uuid", "active") WHERE "active" = true`,
        );
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_parameters_team_active" ON "parameters" ("team_uuid", "active") WHERE "active" = true`,
        );

        // Organization parameters table indexes
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_organization_parameters_key_org_active" ON "organization_parameters" ("key", "organization_uuid", "active") WHERE "active" = true`,
        );
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_organization_parameters_org_active" ON "organization_parameters" ("organization_uuid", "active") WHERE "active" = true`,
        );

        // Teams table indexes
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_teams_organization_active" ON "teams" ("organization_uuid", "active") WHERE "active" = true`,
        );

        // Automation execution table indexes
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_automation_execution_team_automation_period" ON "automation_execution" ("team_automation_uuid", "created_at")`,
        );
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_automation_execution_team_automation_status_period" ON "automation_execution" ("team_automation_uuid", "status", "created_at")`,
        );
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_automation_execution_created_at" ON "automation_execution" ("created_at")`,
        );

        // Integrations table indexes
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_integrations_team_active" ON "integrations" ("team_uuid", "active") WHERE "active" = true`,
        );
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_integrations_team_provider_active" ON "integrations" ("team_uuid", "provider", "active") WHERE "active" = true`,
        );

        // Users table indexes
        await queryRunner.query(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_users_email_active" ON "users" ("email", "active") WHERE "active" = true`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop indexes in reverse order
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_users_email_active"`,
        );

        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_integrations_team_provider_active"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_integrations_team_active"`,
        );

        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_automation_execution_created_at"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_automation_execution_team_automation_status_period"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_automation_execution_team_automation_period"`,
        );

        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_teams_organization_active"`,
        );

        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_organization_parameters_org_active"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_organization_parameters_key_org_active"`,
        );

        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_parameters_team_active"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_parameters_key_team_active"`,
        );
    }
}
