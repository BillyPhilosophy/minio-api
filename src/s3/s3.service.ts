import { Inject, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
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

export interface ListObjectsOptions {
  bucket: string;
  /** 已限定在 <projectId>/ 之内、以 / 结尾的前缀 */
  prefix: string;
  /** 上一页响应的 nextCursor，首页不传 */
  cursor?: string;
  limit: number;
}

export interface ListedObject {
  key: string;
  size: number;
  /** ISO 8601 时间串；MinIO 未返回时为空串 */
  lastModified: string;
}

export interface ListObjectsResult {
  items: ListedObject[];
  /** 还有下一页时为 continuation token，否则为 null */
  nextCursor: string | null;
}

/**
 * 双 client 封装：
 * - apiClient：内网地址，真实 S3 API 调用（文件列举等）
 * - signerClient：公网地址，仅用于预签名（签出的 URL host 必须是浏览器可达地址，
 *   签名是纯本地计算，该 client 不需要网络连通）
 */
@Injectable()
export class S3Service {
  private readonly apiClient: S3Client;
  private readonly signerClient: S3Client;
  private readonly publicBaseUrl: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const shared = {
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKey,
        secretAccessKey: config.s3.secretKey,
      },
      forcePathStyle: config.s3.forcePathStyle,
    };
    this.apiClient = new S3Client({ ...shared, endpoint: config.s3.endpoint });
    this.signerClient = new S3Client({
      ...shared,
      endpoint: config.s3.publicEndpoint,
    });
    this.publicBaseUrl = config.s3.publicEndpoint.replace(/\/+$/, '');
  }

  /** 拼接公开直链（需桶已开匿名读才可直接访问） */
  buildPublicUrl(bucket: string, key: string): string {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return `${this.publicBaseUrl}/${bucket}/${encodedKey}`;
  }

  /** PUT 上传预签名 */
  async presignPut(options: PresignPutOptions): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      // 注意：不签入 ContentType，避免前端 header 不一致导致签名失败；
      // contentType 仅在响应中提示前端自行携带。
    });
    return getSignedUrl(this.signerClient, command, {
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
    return getSignedUrl(this.signerClient, command, {
      expiresIn: options.expiresIn,
    });
  }

  /** DELETE 删除预签名 */
  async presignDelete(options: PresignDeleteOptions): Promise<string> {
    const command = new DeleteObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
    });
    return getSignedUrl(this.signerClient, command, {
      expiresIn: options.expiresIn,
    });
  }

  /** ListObjectsV2 分页列举（真实 API 调用，走内网 client） */
  async listObjects(options: ListObjectsOptions): Promise<ListObjectsResult> {
    const output = await this.apiClient.send(
      new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: options.prefix,
        ContinuationToken: options.cursor,
        MaxKeys: options.limit,
      }),
    );
    const items: ListedObject[] = [];
    for (const obj of output.Contents ?? []) {
      if (!obj.Key) continue;
      items.push({
        key: obj.Key,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified?.toISOString() ?? '',
      });
    }
    return {
      items,
      nextCursor: output.IsTruncated
        ? (output.NextContinuationToken ?? null)
        : null,
    };
  }
}
