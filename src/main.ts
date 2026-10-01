import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { Env } from './config/env';
import { MAX_UPLOAD_BYTES } from './modules/uploads/uploads.controller';

async function bootstrap() {
  // trustProxy so request.ip is the client address behind the load balancer. The body limit
  // leaves room for the canvas previews that accompany each sign at checkout.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 6 * 1024 * 1024 }),
  );
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } });
  app.setGlobalPrefix('v1');
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    // The Fastify CORS plugin defaults to GET, HEAD and POST only.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  Logger.log(`API ready on http://localhost:${port}/v1`, 'Bootstrap');
}

void bootstrap();
