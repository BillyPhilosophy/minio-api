import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller()
export class AppController {
  @ApiOperation({ summary: '健康检查（无需 x-api-key）' })
  @Get('health')
  health(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: process.uptime() };
  }
}
