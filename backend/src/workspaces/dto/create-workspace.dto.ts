// src/workspaces/dto/create-workspace.dto.ts
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorkspaceDto {
  @ApiProperty({ example: 'Machine Learning Research' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Papers on neural architectures and optimization' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
