import { IsString, IsOptional, IsArray, IsDateString } from 'class-validator';

export class BackfillPRsDto {
    @IsString()
    public teamId: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    public repositoryIds?: string[];

    @IsOptional()
    @IsDateString()
    public startDate?: string;

    @IsOptional()
    @IsDateString()
    public endDate?: string;
}

