// src/query/dto/research-gaps.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ResearchGapsDto {
  @ApiPropertyOptional({ description: 'Collection to analyse (all indexed papers) when documentIds is empty' })
  @IsOptional()
  @IsUUID()
  collectionId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Papers to analyse' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  documentIds?: string[];

  @ApiPropertyOptional({ example: 'retrieval for scientific QA' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  topic?: string;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  maxGaps?: number;
}
