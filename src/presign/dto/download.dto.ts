import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class DownloadDto {
  @ApiProperty({
    description: '对象 key，必须以 <projectId>/ 开头',
    example: 'galaxy/2024/06/0f3d....jpg',
  })
  @IsString()
  @MaxLength(1024)
  key!: string;

  @ApiProperty({
    description: '目标桶（必填，必须在白名单内，见 src/presign/allowed-buckets.ts）',
    example: 'audio',
  })
  @IsString()
  bucket!: string;

  @ApiPropertyOptional({
    description: '签名有效期（秒），会被 clamp 到 [60, MAX_EXPIRES_IN]',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  expiresIn?: number;

  @ApiPropertyOptional({
    description: '指定后浏览器以附件下载，文件名走 RFC 5987 编码',
    example: '报告.pdf',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  downloadName?: string;
}
