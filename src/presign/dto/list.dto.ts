import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListDto {
  @ApiProperty({
    description: '目标桶（必填，必须在白名单内，见 src/presign/allowed-buckets.ts）',
    example: 'audio',
  })
  @IsString()
  bucket!: string;

  @ApiPropertyOptional({
    description:
      '路径前缀，可选。无论传什么都会被强制限定在 <projectId>/ 之内；缺省列举整个项目前缀',
    example: '2026/09/',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  prefix?: string;

  @ApiPropertyOptional({
    description: '分页游标，取上一页响应的 nextCursor',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @ApiPropertyOptional({
    description: '每页数量，1-1000，默认 100',
    example: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
