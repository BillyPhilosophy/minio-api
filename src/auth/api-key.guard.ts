import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import type { ProjectContext, RequestWithProject } from './project.types';

/**
 * 校验请求头 x-api-key，匹配 PROJECTS_JSON 中注册的项目，
 * 成功后将 ProjectContext 挂到 req.project。
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-api-key'];
    const apiKey = Array.isArray(header) ? header[0] : header;
    if (!apiKey || apiKey.trim() === '') {
      throw new UnauthorizedException('缺少 x-api-key 请求头');
    }

    for (const [id, entry] of Object.entries(this.config.projects)) {
      if (entry.apiKey === apiKey) {
        const project: ProjectContext = { id };
        (req as RequestWithProject).project = project;
        return true;
      }
    }
    throw new UnauthorizedException('无效的 x-api-key');
  }
}
