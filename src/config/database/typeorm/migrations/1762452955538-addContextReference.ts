import { MigrationInterface, QueryRunner } from "typeorm";

export class AddContextReference1762452955538 implements MigrationInterface {
    name = 'AddContextReference1762452955538'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "public"."IDX_users_email"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_users_org_status"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_integration_team_category_status"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_org_params_key_org"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_org_params_config_value_gin"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_parameters_key_team_active"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_parameters_config_value_gin"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_parameters_active_only"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_teams_org_status"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_teams_org_created"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_automation_exec_team_status"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_automation_exec_pr_repo"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_automation_exec_created_desc"
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."context_references_processingstatus_enum" AS ENUM('pending', 'processing', 'completed', 'failed')
        `);
        await queryRunner.query(`
            CREATE TABLE "context_references" (
                "uuid" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "createdAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "updatedAt" TIMESTAMP NOT NULL DEFAULT ('now'::text)::timestamp(6) with time zone,
                "parentReferenceId" character varying(64),
                "scope" jsonb NOT NULL,
                "entityType" character varying(128) NOT NULL,
                "entityId" character varying(256) NOT NULL,
                "requirements" jsonb,
                "knowledgeRefs" jsonb,
                "revisionId" character varying(256),
                "origin" jsonb,
                "processingStatus" "public"."context_references_processingstatus_enum",
                "lastProcessedAt" TIMESTAMP,
                "metadata" jsonb,
                CONSTRAINT "PK_6e32c0cb61a0388444470095463" PRIMARY KEY ("uuid")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE "context_references"
        `);
        await queryRunner.query(`
            DROP TYPE "public"."context_references_processingstatus_enum"
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_automation_exec_created_desc" ON "automation_execution" ("createdAt")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_automation_exec_pr_repo" ON "automation_execution" ("pullRequestNumber", "repositoryId")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_automation_exec_team_status" ON "automation_execution" ("status", "team_automation_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_teams_org_created" ON "teams" ("createdAt", "organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_teams_org_status" ON "teams" ("organization_id", "status")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_parameters_active_only" ON "parameters" ("active")
            WHERE (active = true)
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_parameters_config_value_gin" ON "parameters" ("configValue")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_parameters_key_team_active" ON "parameters" ("configKey", "team_id", "active")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_org_params_config_value_gin" ON "organization_parameters" ("configValue")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_org_params_key_org" ON "organization_parameters" ("configKey", "organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_integration_team_category_status" ON "integrations" ("status", "integrationCategory", "team_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_users_org_status" ON "users" ("organization_id", "status")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_users_email" ON "users" ("email")
        `);
    }

}
