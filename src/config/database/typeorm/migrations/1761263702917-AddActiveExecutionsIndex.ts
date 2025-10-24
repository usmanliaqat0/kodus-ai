import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActiveExecutionsIndex1761263702917
    implements MigrationInterface
{
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE INDEX "idx_active_executions"
            ON "automation_execution" (
                "team_automation_id",
                "pullRequestNumber",
                "repositoryId",
                "status",
                "createdAt"
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "idx_active_executions"
        `);
    }
}
