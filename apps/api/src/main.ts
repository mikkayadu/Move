import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const origins = config.get<string[]>('corsOrigins') ?? [];
  app.enableCors({
    origin: origins.includes('*') ? true : origins,
    allowedHeaders: ['content-type', 'x-device-id'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  const port = config.get<number>('port') ?? 3001;
  await app.listen(port, '0.0.0.0');

  logger.log(`Move API listening on http://localhost:${port}/api`);
  if (!config.get<string>('googleAiApiKey')) {
    logger.warn('GOOGLE_AI_API_KEY is missing - recommendations will fail until it is set.');
  }
  if (!config.get<string>('mapboxAccessToken')) {
    logger.warn('MAPBOX_ACCESS_TOKEN is missing - routing will fail until it is set.');
  }
}

void bootstrap();
