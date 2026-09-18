import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PresignService } from './presign.service';
import {
  ALLOWED_BUCKETS,
  isAllowedBucket,
  type AllowedBucket,
} from './allowed-buckets';
import type { AppConfig } from '../config/configuration';
import type { ProjectContext } from '../auth/project.types';
import type { ListObjectsResult, S3Service } from '../s3/s3.service';

const config: AppConfig = {
  port: 3100,
  s3: {
    endpoint: 'http://minio:9000',
    publicEndpoint: 'https://minio.example.com',
    region: 'us-east-1',
    accessKey: 'ak',
    secretKey: 'sk',
    forcePathStyle: true,
  },
  projects: {
    galaxy: { apiKey: 'gk_test' },
  },
  defaultExpiresIn: 900,
  maxExpiresIn: 3600,
};

const project: ProjectContext = { id: 'galaxy' };

/** 不真实访问 S3 的 mock */
const s3MockImpls = {
  presignPut: jest.fn(async () => 'https://signed/put'),
  presignGet: jest.fn(async () => 'https://signed/get'),
  presignDelete: jest.fn(async () => 'https://signed/delete'),
  listObjects: jest.fn(
    async (): Promise<ListObjectsResult> => ({ items: [], nextCursor: null }),
  ),
  buildPublicUrl: jest.fn(
    (bucket: string, key: string) => `https://minio.example.com/${bucket}/${key}`,
  ),
};
const s3Mock = s3MockImpls as unknown as S3Service;

describe('PresignService', () => {
  let service: PresignService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PresignService(config, s3Mock);
  });

  describe('generateKey / extractExt', () => {
    it('按 <projectId>/<yyyy>/<mm>/<uuid><ext小写> 生成 key', () => {
      const now = new Date(Date.UTC(2024, 5, 9)); // 2024-06
      const key = service.generateKey('galaxy', 'Photo.JPG', now);
      expect(key).toMatch(
        /^galaxy\/2024\/06\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
      );
    });

    it('无扩展名或非法扩展名时不加后缀', () => {
      const now = new Date(Date.UTC(2024, 0, 1));
      expect(service.generateKey('galaxy', 'noext', now)).toMatch(
        /^galaxy\/2024\/01\/[0-9a-f-]{36}$/,
      );
      expect(service.extractExt('a.b@c')).toBe('');
      expect(service.extractExt('.hidden')).toBe('');
      expect(service.extractExt('archive.tar.GZ')).toBe('.gz');
    });
  });

  describe('sanitizeKey / ensureProjectPrefix', () => {
    it('拒绝以 / 开头、.. 段、反斜杠', () => {
      expect(() => service.sanitizeKey('/etc/passwd')).toThrow(
        BadRequestException,
      );
      expect(() => service.sanitizeKey('a/../../b')).toThrow(
        BadRequestException,
      );
      expect(() => service.sanitizeKey('a\\b')).toThrow(BadRequestException);
      expect(() => service.sanitizeKey('   ')).toThrow(BadRequestException);
    });

    it('清洗空段与 . 段', () => {
      expect(service.sanitizeKey('a//b/./c.png')).toBe('a/b/c.png');
    });

    it('强制 <projectId>/ 前缀且不重复添加', () => {
      expect(service.ensureProjectPrefix('galaxy', 'a/b.png')).toBe(
        'galaxy/a/b.png',
      );
      expect(service.ensureProjectPrefix('galaxy', 'galaxy/a.png')).toBe(
        'galaxy/a.png',
      );
    });
  });

  describe('assertProjectPrefix（防跨项目读/删）', () => {
    it('非本项目前缀抛 403', () => {
      expect(() => service.assertProjectPrefix('galaxy', 'blog/x.png')).toThrow(
        ForbiddenException,
      );
      expect(() =>
        service.assertProjectPrefix('galaxy', 'galaxy-2/x.png'),
      ).toThrow(ForbiddenException);
      expect(() =>
        service.assertProjectPrefix('galaxy', 'galaxy/x.png'),
      ).not.toThrow();
    });
  });

  describe('clampExpiresIn', () => {
    it('clamp 到 [60, MAX_EXPIRES_IN]，缺省用 DEFAULT_EXPIRES_IN', () => {
      expect(service.clampExpiresIn(undefined)).toBe(900);
      expect(service.clampExpiresIn(1)).toBe(60);
      expect(service.clampExpiresIn(99999)).toBe(3600);
      expect(service.clampExpiresIn(1200)).toBe(1200);
    });
  });

  describe('isAllowedBucket（联合类型白名单）', () => {
    it("'audio' 通过，'evil-bucket' 不通过", () => {
      expect(isAllowedBucket('audio')).toBe(true);
      expect(isAllowedBucket('evil-bucket')).toBe(false);
      expect(isAllowedBucket('')).toBe(false);
    });

    it('ALLOWED_BUCKETS 是只读字面量元组，AllowedBucket 为其联合类型', () => {
      expect(ALLOWED_BUCKETS).toEqual(['audio']);
      const bucket: AllowedBucket = 'audio';
      expect(isAllowedBucket(bucket)).toBe(true);
    });
  });

  describe('resolveBucket（全局白名单）', () => {
    it("'audio' 通过，'evil-bucket' 抛 403", () => {
      expect(service.resolveBucket('audio')).toBe('audio');
      expect(() => service.resolveBucket('evil-bucket')).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('presignUpload 端到端逻辑', () => {
    it('filename 与 key 都不给时 400', async () => {
      await expect(
        service.presignUpload(project, {
          contentType: 'image/png',
          bucket: 'audio',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('直接给 key 时强制项目前缀并返回提示 header 与直链', async () => {
      const result = await service.presignUpload(project, {
        key: 'avatars/pic.png',
        contentType: 'image/png',
        bucket: 'audio',
      });
      expect(result.method).toBe('PUT');
      expect(result.key).toBe('galaxy/avatars/pic.png');
      expect(result.bucket).toBe('audio');
      expect(result.headers).toEqual({ 'Content-Type': 'image/png' });
      expect(result.publicUrl).toBe(
        'https://minio.example.com/audio/galaxy/avatars/pic.png',
      );
    });

    it('bucket 不在白名单时 403', async () => {
      await expect(
        service.presignUpload(project, {
          key: 'avatars/pic.png',
          contentType: 'image/png',
          bucket: 'evil-bucket',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('buildListPrefix（list 前缀限定）', () => {
    it('空 prefix 列举整个项目前缀', () => {
      expect(service.buildListPrefix('galaxy')).toBe('galaxy/');
      expect(service.buildListPrefix('galaxy', '  ')).toBe('galaxy/');
    });

    it('用户 prefix 强制落在项目前缀内，保证以 / 结尾', () => {
      expect(service.buildListPrefix('galaxy', 'covers')).toBe(
        'galaxy/covers/',
      );
      expect(service.buildListPrefix('galaxy', 'galaxy/covers/')).toBe(
        'galaxy/covers/',
      );
      // 试图用其它项目前缀会被拉回本项目内，无法越权
      expect(service.buildListPrefix('galaxy', 'blog/x')).toBe(
        'galaxy/blog/x/',
      );
    });

    it('路径穿越抛 400', () => {
      expect(() => service.buildListPrefix('galaxy', '../etc')).toThrow(
        BadRequestException,
      );
      expect(() => service.buildListPrefix('galaxy', '/abs')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('listFiles 端到端逻辑', () => {
    it('默认参数：项目前缀 + limit 100', async () => {
      const result = await service.listFiles(project, { bucket: 'audio' });
      expect(s3MockImpls.listObjects).toHaveBeenCalledWith({
        bucket: 'audio',
        prefix: 'galaxy/',
        cursor: undefined,
        limit: 100,
      });
      expect(result).toEqual({
        bucket: 'audio',
        prefix: 'galaxy/',
        count: 0,
        nextCursor: null,
        items: [],
      });
    });

    it('返回项附直链，分页游标透传', async () => {
      s3MockImpls.listObjects.mockResolvedValueOnce({
        items: [
          {
            key: 'galaxy/a.mp3',
            size: 10,
            lastModified: '2026-09-18T00:00:00.000Z',
          },
        ],
        nextCursor: 'token-2',
      });
      const result = await service.listFiles(project, {
        bucket: 'audio',
        prefix: 'a',
        cursor: 'token-1',
        limit: 1,
      });
      expect(s3MockImpls.listObjects).toHaveBeenCalledWith({
        bucket: 'audio',
        prefix: 'galaxy/a/',
        cursor: 'token-1',
        limit: 1,
      });
      expect(result.count).toBe(1);
      expect(result.nextCursor).toBe('token-2');
      expect(result.items[0]).toEqual({
        key: 'galaxy/a.mp3',
        size: 10,
        lastModified: '2026-09-18T00:00:00.000Z',
        url: 'https://minio.example.com/audio/galaxy/a.mp3',
      });
    });

    it('bucket 不在白名单时 403', async () => {
      await expect(
        service.listFiles(project, { bucket: 'evil-bucket' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
