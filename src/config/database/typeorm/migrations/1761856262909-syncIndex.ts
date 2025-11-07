import { MigrationInterface, QueryRunner } from "typeorm";

export class SyncIndex1761856262909 implements MigrationInterface {
    name = 'SyncIndex1761856262909'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "public"."IDX_users_org_status"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_users_email"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_integration_team_category_status"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_org_params_config_value_gin"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_org_params_key_org"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_parameters_active_only"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_parameters_config_value_gin"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_parameters_key_team_active"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_teams_org_created"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_teams_org_status"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_automation_exec_created_desc"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_automation_exec_pr_repo"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_automation_exec_team_status"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."idx_active_executions"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."idx_unique_active_execution"
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_unique_active_execution" ON "automation_execution" (
                "pullRequestNumber",
                "repositoryId",
                "status",
                "team_automation_id"
            )
            WHERE (
                    status = 'in_progress'::automation_execution_status_enum
                )
        `);
        await queryRunner.query(`
            CREATE INDEX "idx_active_executions" ON "automation_execution" (
                "createdAt",
                "pullRequestNumber",
                "repositoryId",
                "status",
                "team_automation_id"
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_automation_exec_team_status" ON "automation_execution" ("status", "team_automation_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_automation_exec_pr_repo" ON "automation_execution" ("pullRequestNumber", "repositoryId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_automation_exec_created_desc" ON "automation_execution" ("createdAt")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_teams_org_status" ON "teams" ("organization_id", "status")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_teams_org_created" ON "teams" ("createdAt", "organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_parameters_key_team_active" ON "parameters" ("active", "configKey", "team_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_parameters_config_value_gin" ON "parameters" ("configValue")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_parameters_active_only" ON "parameters" ("active")
            WHERE (active = true)
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_org_params_key_org" ON "organization_parameters" ("configKey", "organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_org_params_config_value_gin" ON "organization_parameters" ("configValue")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_integration_team_category_status" ON "integrations" ("integrationCategory", "status", "team_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_users_email" ON "users" ("email")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_users_org_status" ON "users" ("organization_id", "status")
        `);
    }

}
