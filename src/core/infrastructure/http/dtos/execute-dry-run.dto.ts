import { IsNumber, IsString } from 'class-validator';

export class ExecuteDryRunDto {
    @IsString()
    teamId: string;

    @IsString()
    repositoryId: string;

    @IsNumber()
    prNumber: number;
}
