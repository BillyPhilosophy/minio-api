import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import type { RequestWithProject } from '../auth/project.types';
import { PresignService } from './presign.service';
import { UploadDto } from './dto/upload.dto';
import { DownloadDto } from './dto/download.dto';
import { DeleteDto } from './dto/delete.dto';

@ApiTags('presign')
@ApiHeader({ name: 'x-api-key', required: true, description: '项目 API Key' })
@ApiResponse({ status: 401, description: 'x-api-key 缺失或无效' })
@ApiResponse({ status: 403, description: 'bucket 不在白名单 / key 前缀越权' })
@UseGuards(ApiKeyGuard)
@Controller('v1/presign')
export class PresignController {
  constructor(private readonly presignService: PresignService) {}

  @ApiOperation({ summary: '签发 PUT 上传预签名 URL' })
  @Post('upload')
  upload(@Req() req: RequestWithProject, @Body() dto: UploadDto) {
    return this.presignService.presignUpload(req.project, dto);
  }

  @ApiOperation({ summary: '签发 GET 下载预签名 URL' })
  @Post('download')
  download(@Req() req: RequestWithProject, @Body() dto: DownloadDto) {
    return this.presignService.presignDownload(req.project, dto);
  }

  @ApiOperation({ summary: '签发 DELETE 删除预签名 URL' })
  @Post('delete')
  remove(@Req() req: RequestWithProject, @Body() dto: DeleteDto) {
    return this.presignService.presignDelete(req.project, dto);
  }
}
