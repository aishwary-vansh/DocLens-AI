// src/auth/dto/google-login.dto.ts
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({ description: 'ID token ("credential") returned by Google Identity Services' })
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  credential: string;
}

export class GoogleExchangeDto {
  @ApiProperty({ description: 'One-time code from the #/login?google_code=… redirect' })
  @IsString()
  @MinLength(20)
  @MaxLength(128)
  code: string;
}
