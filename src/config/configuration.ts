/**
 * 配置模块：全部从环境变量读取，启动时校验，缺项直接 throw（fail-fast）。
 */

/** DI token */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** 单个项目的注册信息（来自 PROJECTS_JSON） */
export interface ProjectEntry {
  /** 该项目使用的 API Key（请求头 x-api-key） */
  apiKey: string;
}

/** 规范化后的项目注册表 */
export interface NormalizedProjectEntry {
  apiKey: string;
}

export interface AppConfig {
  port: number;
  s3: {
    /** 内网 API 地址：真实 S3 调用（如文件列举）走这里 */
    endpoint: string;
    /** 公网地址：预签名 URL 的 host 与直链拼接；缺省回退 endpoint */
    publicEndpoint: string;
    region: string;
    accessKey: string;
    secretKey: string;
    forcePathStyle: boolean;
  };
  /** projectId -> 项目配置 */
  projects: Record<string, NormalizedProjectEntry>;
  defaultExpiresIn: number;
  maxExpiresIn: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`[config] 缺少必填环境变量: ${name}`);
  }
  return value;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`[config] 环境变量 ${name} 必须是正整数，当前值: "${raw}"`);
  }
  return parsed;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** 解析并校验 PROJECTS_JSON */
export function parseProjectsJson(
  raw: string,
): Record<string, NormalizedProjectEntry> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('[config] PROJECTS_JSON 不是合法 JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('[config] PROJECTS_JSON 必须是对象: { projectId: { apiKey } }');
  }

  const result: Record<string, NormalizedProjectEntry> = {};
  for (const [projectId, entry] of Object.entries(
    parsed as Record<string, Partial<ProjectEntry>>,
  )) {
    if (!projectId || projectId.includes('/')) {
      throw new Error(`[config] PROJECTS_JSON 中非法 projectId: "${projectId}"`);
    }
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`[config] 项目 "${projectId}" 的配置必须是对象`);
    }
    if (typeof entry.apiKey !== 'string' || entry.apiKey.trim() === '') {
      throw new Error(`[config] 项目 "${projectId}" 缺少 apiKey`);
    }
    result[projectId] = { apiKey: entry.apiKey };
  }

  if (Object.keys(result).length === 0) {
    throw new Error('[config] PROJECTS_JSON 至少要注册一个项目');
  }
  return result;
}

/** 读取全部环境变量并返回应用配置；任何缺项/非法项都会 throw */
export function loadConfig(): AppConfig {
  const defaultExpiresIn = parseIntEnv('DEFAULT_EXPIRES_IN', 900);
  const maxExpiresIn = parseIntEnv('MAX_EXPIRES_IN', 3600);
  if (defaultExpiresIn > maxExpiresIn) {
    throw new Error(
      `[config] DEFAULT_EXPIRES_IN (${defaultExpiresIn}) 不能大于 MAX_EXPIRES_IN (${maxExpiresIn})`,
    );
  }

  const s3Endpoint = requiredEnv('S3_ENDPOINT');

  return {
    port: parseIntEnv('PORT', 3100),
    s3: {
      endpoint: s3Endpoint,
      publicEndpoint: process.env.S3_PUBLIC_ENDPOINT?.trim() || s3Endpoint,
      region: process.env.S3_REGION?.trim() || 'us-east-1',
      accessKey: requiredEnv('S3_ACCESS_KEY'),
      secretKey: requiredEnv('S3_SECRET_KEY'),
      forcePathStyle: parseBoolEnv('S3_FORCE_PATH_STYLE', true),
    },
    projects: parseProjectsJson(requiredEnv('PROJECTS_JSON')),
    defaultExpiresIn,
    maxExpiresIn,
  };
}
