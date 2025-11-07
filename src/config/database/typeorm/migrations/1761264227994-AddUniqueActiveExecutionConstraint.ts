import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueActiveExecutionConstraint1761264227994
    implements MigrationInterface
{
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Step 1: Identify and log duplicate in_progress executions
        const duplicates = await queryRunner.query(`
            SELECT
                "team_automation_id",
                "pullRequestNumber",
                "repositoryId",
                COUNT(*) as count
            FROM "automation_execution"
            WHERE "status" = 'in_progress'
            GROUP BY "team_automation_id", "pullRequestNumber", "repositoryId"
            HAVING COUNT(*) > 1
        `);

        if (duplicates.length > 0) {
            console.log('Found duplicate in_progress executions:', duplicates);
        }

        // Step 2: Keep only the OLDEST execution (by createdAt), mark others as error
        await queryRunner.query(`
            UPDATE "automation_execution" ae
            SET
                "status" = 'error',
                "errorMessage" = 'Marked as error during migration - duplicate execution detected'
            WHERE "status" = 'in_progress'
            AND "uuid" NOT IN (
                SELECT DISTINCT ON ("team_automation_id", "pullRequestNumber", "repositoryId") "uuid"
                FROM "automation_execution"
                WHERE "status" = 'in_progress'
                ORDER BY "team_automation_id", "pullRequestNumber", "repositoryId", "createdAt" ASC
            )
        `);

        // Step 3: Now create the unique index (safe, no duplicates)
        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_unique_active_execution"
            ON "automation_execution" (
                "team_automation_id",
                "pullRequestNumber",
                "repositoryId",
                "status"
            )
            WHERE "status" = 'in_progress'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "idx_unique_active_execution"
        `);
    }
}
