import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { APP_CONFIG, loadConfig, type AppConfig } from './config/configuration';
import { ApiKeyGuard } from './auth/api-key.guard';
import { S3Service } from './s3/s3.service';
import { PresignController } from './presign/presign.controller';
import { FilesController } from './presign/files.controller';
import { PresignService } from './presign/presign.service';

@Module({
  imports: [],
  controllers: [AppController, PresignController, FilesController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(),
    },
    ApiKeyGuard,
    S3Service,
    PresignService,
  ],
})
export class AppModule {}
