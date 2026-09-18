import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsMimeType,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class UploadDto {
  @ApiPropertyOptional({
    description: '原始文件名，用于推断扩展名并生成 key（与 key 二选一，必给其一）',
    example: 'photo.JPG',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;

  @ApiPropertyOptional({
    description: '直接指定对象 key（会自动强制加上 <projectId>/ 前缀）',
    example: 'avatars/2024/pic.png',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  key?: string;

  @ApiProperty({ description: 'MIME 类型', example: 'image/jpeg' })
  @IsString()
  @IsMimeType()
  contentType!: string;

  @ApiProperty({
    description: '目标桶（必填，必须在白名单内，见 src/presign/allowed-buckets.ts）',
    example: 'audio',
  })
  @IsString()
  bucket!: string;

  @ApiPropertyOptional({
    description: '签名有效期（秒），会被 clamp 到 [60, MAX_EXPIRES_IN]',
    example: 900,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  expiresIn?: number;
}
