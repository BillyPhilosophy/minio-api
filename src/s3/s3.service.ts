import { Inject, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APP_CONFIG, type AppConfig } from '../config/configuration';

export interface PresignPutOptions {
  bucket: string;
  key: string;
  expiresIn: number;
  /**
   * 仅作为提示返回给前端，不写入签名（MinIO 兼容性考虑，
   * 强制签 Content-Type 会让前端 headers 稍有出入就签名失效）。
   */
  contentType?: string;
}

export interface PresignGetOptions {
  bucket: string;
  key: string;
  expiresIn: number;
  /** 指定时通过 response-content-disposition 让浏览器以附件形式下载 */
  downloadName?: string;
}

export interface PresignDeleteOptions {
  bucket: string;
  key: string;
  expiresIn: number;
}

/** 单例 S3Client，封装三种预签名 */
@Injectable()
export class S3Service {
  private readonly client: S3Client;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKey,
        secretAccessKey: config.s3.secretKey,
      },
      forcePathStyle: config.s3.forcePathStyle,
    });
  }

  /** PUT 上传预签名 */
  async presignPut(options: PresignPutOptions): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      // 注意：不签入 ContentType，避免前端 header 不一致导致签名失败；
      // contentType 仅在响应中提示前端自行携带。
    });
    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn,
    });
  }

  /** GET 下载预签名 */
  async presignGet(options: PresignGetOptions): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      ...(options.downloadName
        ? {
            ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(
              options.downloadName,
            )}`,
          }
        : {}),
    });
    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn,
    });
  }

  /** DELETE 删除预签名 */
  async presignDelete(options: PresignDeleteOptions): Promise<string> {
    const command = new DeleteObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn,
    });
  }
}
