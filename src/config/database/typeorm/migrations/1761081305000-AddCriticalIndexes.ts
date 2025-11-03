import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCriticalIndexes1761081305000 implements MigrationInterface {
    name = 'AddCriticalIndexes1761081305000';

    // CRITICAL: Disable transactions for CONCURRENT index creation
    // Without this, CREATE INDEX CONCURRENTLY will fail
    transaction = false;

    public async up(queryRunner: QueryRunner): Promise<void> {
        // ==========================================
        // PARAMETERS TABLE - Most critical (33 uses)
        // ==========================================

        // Índice composto mais usado: configKey + team_id + active
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_parameters_key_team_active"
            ON "parameters" ("configKey", "team_id", "active")
        `);

        // Índice GIN para queries JSONB (configValue @> ...)
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_parameters_config_value_gin"
            ON "parameters" USING GIN ("configValue")
        `);

        // Índice parcial para registros ativos (otimiza WHERE active = true)
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_parameters_active_only"
            ON "parameters" ("active")
            WHERE "active" = true
        `);

        // ==========================================
        // ORGANIZATION_PARAMETERS TABLE - High use
        // ==========================================

        // Índice composto: configKey + organization_id
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_org_params_key_org"
            ON "organization_parameters" ("configKey", "organization_id")
        `);

        // Índice GIN para JSONB queries
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_org_params_config_value_gin"
            ON "organization_parameters" USING GIN ("configValue")
        `);

        // ==========================================
        // TEAMS TABLE - Organization lookups
        // ==========================================

        // Índice composto: organization_id + status
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_teams_org_status"
            ON "teams" ("organization_id", "status")
        `);

        // Índice para ordenação por data de criação
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_teams_org_created"
            ON "teams" ("organization_id", "createdAt")
        `);

        // ==========================================
        // AUTOMATION_EXECUTION TABLE - Performance
        // ==========================================

        // Índice composto: teamAutomation_id + status
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_automation_exec_team_status"
            ON "automation_execution" ("team_automation_id", "status")
        `);

        // Índice composto: pullRequestNumber + repositoryId
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_automation_exec_pr_repo"
            ON "automation_execution" ("pullRequestNumber", "repositoryId")
        `);

        // Índice para ordenação temporal (queries recentes)
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_automation_exec_created_desc"
            ON "automation_execution" ("createdAt" DESC)
        `);

        // ==========================================
        // INTEGRATIONS TABLE - Team lookups
        // ==========================================

        // Índice composto: team_id + integrationCategory + status
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_integration_team_category_status"
            ON "integrations" ("team_id", "integrationCategory", "status")
        `);

        // ==========================================
        // USERS TABLE - Authentication & Lookups
        // ==========================================

        // Email já tem UNIQUE constraint, mas garantir índice explícito
        // (geralmente já existe, mas fica documentado na migration)
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_users_email"
            ON "users" ("email")
        `);

        // Índice para listagem por organização
        await queryRunner.query(`
            CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_users_org_status"
            ON "users" ("organization_id", "status")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop indexes in reverse order
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_users_org_status"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_users_email"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_integration_team_category_status"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_automation_exec_created_desc"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_automation_exec_pr_repo"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_automation_exec_team_status"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_teams_org_created"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_teams_org_status"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_org_params_config_value_gin"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_org_params_key_org"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_parameters_active_only"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_parameters_config_value_gin"`,
        );
        await queryRunner.query(
            `DROP INDEX CONCURRENTLY IF EXISTS "IDX_parameters_key_team_active"`,
        );
    }
}
