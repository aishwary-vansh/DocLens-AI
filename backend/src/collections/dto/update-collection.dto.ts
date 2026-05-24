// src/collections/dto/update-collection.dto.ts
import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateCollectionDto } from './create-collection.dto';

// workspaceId is immutable after creation
export class UpdateCollectionDto extends PartialType(
  OmitType(CreateCollectionDto, ['workspaceId'] as const),
) {}
