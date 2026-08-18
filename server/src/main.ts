import 'reflect-metadata';
// ⚠️ dotenv ไม่เขียนทับค่าที่มีอยู่แล้ว — บน docker/IIS ที่ส่ง env มาให้จริง
//    บรรทัดนี้จึงไม่มีผล มีไว้ให้ `npm start` บนเครื่อง dev อ่าน .env ได้
import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { configureApp, configureRuntime } from './bootstrap.js';
import { loadEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  // ⚠️ bodyParser: false เพื่อให้ configureApp เป็นคนตั้งเอง — ดูเหตุผลที่นั่น
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  configureApp(app);
  configureRuntime(app, env.WEB_ORIGIN);

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Project Management API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, config));
  }

  await app.listen(env.PORT);
  new Logger('bootstrap').log(`ฟังอยู่ที่พอร์ต ${env.PORT} (${env.NODE_ENV})`);
}

await bootstrap();
