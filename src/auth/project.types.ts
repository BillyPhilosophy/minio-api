import type { Request } from 'express';

/** 通过 API Key 鉴定出的项目上下文，挂到 req.project 上 */
export interface ProjectContext {
  /** 项目 ID（PROJECTS_JSON 的 key） */
  id: string;
}

/** 附带 ProjectContext 的请求对象 */
export interface RequestWithProject extends Request {
  project: ProjectContext;
}
