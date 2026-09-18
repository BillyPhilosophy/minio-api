import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import type { ProjectContext } from '../auth/project.types';
import { isAllowedBucket, type AllowedBucket } from './allowed-buckets';
import { S3Service } from '../s3/s3.service';
import type { UploadDto } from './dto/upload.dto';
import type { DownloadDto } from './dto/download.dto';
import type { DeleteDto } from './dto/delete.dto';

export interface UploadPresignResult {
  method: 'PUT';
  url: string;
  bucket: string;
  key: string;
  expiresIn: number;
  /** 提示前端 PUT 时必须携带的 header（未签入签名） */
  headers: { 'Content-Type': string };
  publicUrl: null;
}

export interface DownloadPresignResult {
  method: 'GET';
  url: string;
  bucket: string;
  key: string;
  expiresIn: number;
}

export interface DeletePresignResult {
  method: 'DELETE';
  url: string;
  bucket: string;
  key: string;
  expiresIn: number;
}

/** 允许出现在扩展名里的字符 */
const EXT_PATTERN = /^[a-z0-9]{1,10}$/;

@Injectable()
export class PresignService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly s3: S3Service,
  ) {}

  /** 解析目标桶：必须在全局白名单 ALLOWED_BUCKETS 内，否则 403 */
  resolveBucket(bucket: string): AllowedBucket {
    const target = bucket.trim();
    if (!isAllowedBucket(target)) {
      throw new ForbiddenException(`桶 "${target}" 不在白名单内`);
    }
    return target;
  }

  /** expiresIn clamp 到 [60, MAX_EXPIRES_IN]，缺省用 DEFAULT_EXPIRES_IN */
  clampExpiresIn(expiresIn?: number): number {
    const fallback = this.config.defaultExpiresIn;
    if (expiresIn === undefined || expiresIn === null) {
      return Math.min(Math.max(fallback, 60), this.config.maxExpiresIn);
    }
    return Math.min(Math.max(expiresIn, 60), this.config.maxExpiresIn);
  }

  /**
   * 从原始文件名提取小写扩展名（含点），不合法则返回空串。
   * 例："photo.JPG" -> ".jpg"，"archive.tar.gz" -> ".gz"，"noext" -> ""
   */
  extractExt(filename: string): string {
    const base = filename.split(/[\\/]/).pop() ?? '';
    const dotIndex = base.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === base.length - 1) {
      return '';
    }
    const ext = base.slice(dotIndex + 1).toLowerCase();
    return EXT_PATTERN.test(ext) ? `.${ext}` : '';
  }

  /** 由 filename 生成 key：<projectId>/<yyyy>/<mm>/<uuidv4><ext小写> */
  generateKey(projectId: string, filename: string, now = new Date()): string {
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const ext = this.extractExt(filename);
    return `${projectId}/${yyyy}/${mm}/${randomUUID()}${ext}`;
  }

  /**
   * 清洗用户提供的 key（路径穿越防护）：
   * - 拒绝以 "/" 开头、包含 ".." 段、反斜杠、控制字符
   * - 去掉空的与 "." 段
   * 返回清洗后的相对 key。
   */
  sanitizeKey(key: string): string {
    const trimmed = key.trim();
    if (trimmed === '') {
      throw new BadRequestException('key 不能为空');
    }
    if (trimmed.startsWith('/')) {
      throw new BadRequestException('key 不允许以 "/" 开头');
    }
    if (/\\/.test(trimmed)) {
      throw new BadRequestException('key 不允许包含反斜杠');
    }
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
      throw new BadRequestException('key 不允许包含控制字符');
    }
    const segments = trimmed.split('/');
    if (segments.some((seg) => seg === '..')) {
      throw new BadRequestException('key 不允许包含 ".."（路径穿越）');
    }
    const cleaned = segments.filter((seg) => seg !== '' && seg !== '.');
    if (cleaned.length === 0) {
      throw new BadRequestException('key 清洗后为空');
    }
    return cleaned.join('/');
  }

  /**
   * 上传用：强制 key 带 <projectId>/ 前缀（已带则不重复加）。
   */
  ensureProjectPrefix(projectId: string, key: string): string {
    const prefix = `${projectId}/`;
    return key.startsWith(prefix) ? key : prefix + key;
  }

  /**
   * 下载/删除用：校验 key 属于该项目前缀，防止跨项目读/删，否则 403。
   */
  assertProjectPrefix(projectId: string, key: string): void {
    if (!key.startsWith(`${projectId}/`)) {
      throw new ForbiddenException(
        `key "${key}" 不属于项目 "${projectId}"（必须以 "${projectId}/" 开头）`,
      );
    }
  }

  async presignUpload(
    project: ProjectContext,
    dto: UploadDto,
  ): Promise<UploadPresignResult> {
    if (!dto.filename && !dto.key) {
      throw new BadRequestException('filename 与 key 必须提供其一');
    }

    let key: string;
    if (dto.key) {
      // 用户直接指定 key：清洗路径穿越 + 强制项目前缀
      key = this.ensureProjectPrefix(project.id, this.sanitizeKey(dto.key));
    } else {
      // 只有 filename：服务端生成 key
      key = this.generateKey(project.id, dto.filename as string);
    }

    const bucket = this.resolveBucket(dto.bucket);
    const expiresIn = this.clampExpiresIn(dto.expiresIn);
    const url = await this.s3.presignPut({
      bucket,
      key,
      expiresIn,
      contentType: dto.contentType,
    });

    return {
      method: 'PUT',
      url,
      bucket,
      key,
      expiresIn,
      headers: { 'Content-Type': dto.contentType },
      publicUrl: null,
    };
  }

  async presignDownload(
    project: ProjectContext,
    dto: DownloadDto,
  ): Promise<DownloadPresignResult> {
    const key = this.sanitizeKey(dto.key);
    this.assertProjectPrefix(project.id, key);
    const bucket = this.resolveBucket(dto.bucket);
    const expiresIn = this.clampExpiresIn(dto.expiresIn);
    const url = await this.s3.presignGet({
      bucket,
      key,
      expiresIn,
      downloadName: dto.downloadName,
    });
    return { method: 'GET', url, bucket, key, expiresIn };
  }

  async presignDelete(
    project: ProjectContext,
    dto: DeleteDto,
  ): Promise<DeletePresignResult> {
    const key = this.sanitizeKey(dto.key);
    this.assertProjectPrefix(project.id, key);
    const bucket = this.resolveBucket(dto.bucket);
    const expiresIn = this.clampExpiresIn(dto.expiresIn);
    const url = await this.s3.presignDelete({ bucket, key, expiresIn });
    return { method: 'DELETE', url, bucket, key, expiresIn };
  }
}
