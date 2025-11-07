import { MigrationInterface, QueryRunner } from "typeorm";

export class ParametersVersion1761856917174 implements MigrationInterface {
    name = 'ParametersVersion1761856917174'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "parameters"
            ADD "version" integer NOT NULL DEFAULT '1'
        `);
        await queryRunner.query(`
            ALTER TABLE "parameters" DROP COLUMN "description"
        `);
        await queryRunner.query(`
            ALTER TABLE "parameters"
            ADD "description" text
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "parameters" DROP COLUMN "description"
        `);
        await queryRunner.query(`
            ALTER TABLE "parameters"
            ADD "description" character varying
        `);
        await queryRunner.query(`
            ALTER TABLE "parameters" DROP COLUMN "version"
        `);
    }

}
