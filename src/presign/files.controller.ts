import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import type { RequestWithProject } from '../auth/project.types';
import { PresignService } from './presign.service';
import { ListDto } from './dto/list.dto';

@ApiTags('files')
@ApiHeader({ name: 'x-api-key', required: true, description: '项目 API Key' })
@ApiResponse({ status: 401, description: 'x-api-key 缺失或无效' })
@ApiResponse({ status: 403, description: 'bucket 不在白名单' })
@UseGuards(ApiKeyGuard)
@Controller('v1/files')
export class FilesController {
  constructor(private readonly presignService: PresignService) {}

  @ApiOperation({ summary: '列举本项目前缀下的文件，附公开直链（分页）' })
  @Get()
  list(@Req() req: RequestWithProject, @Query() dto: ListDto) {
    return this.presignService.listFiles(req.project, dto);
  }
}
