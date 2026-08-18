import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';

import { ApiExceptionFilter } from './common/api-exception.filter.js';

// ═══════════════════════════════════════════════════════════════════════════
//  การตั้งค่าที่ production กับเทสต้องเหมือนกัน
//
//  ⚠️ มีอยู่เพราะเทสเคยตั้งค่าเองทีละไฟล์ แล้วมันเริ่มไม่ตรงกับ main.ts —
//     เทสที่รันบนแอปคนละแบบกับของจริงคือเทสที่พิสูจน์อะไรไม่ได้
// ═══════════════════════════════════════════════════════════════════════════
export function configureApp(app: INestApplication): void {
  // ของเดิมเสิร์ฟที่ /api/v1 — web/.env และ nginx.conf ชี้มาที่นี่อยู่แล้ว
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());

  // ─────────────────────────────────────────────────────────────────────
  //  ⚠️ strict: false ไม่ใช่การผ่อนกฎ — มันย้ายการตัดสินใจมาไว้ในมือเรา
  //
  //  ค่า default (strict) ให้ body-parser โยน SyntaxError เองเมื่อเจอ JSON ที่
  //  ไม่ใช่ object/array เช่น `null` เปล่า ๆ error นั้นเกิดใน middleware ก่อนถึง
  //  pipe ของเรา ผลคือผู้เรียกได้ข้อความของ library แทน envelope ของระบบ และ
  //  code เป็น http_error แทน invalid_body ที่ client เดิมใช้แยกกรณี
  //
  //  strict: false ทำให้ `null` เข้ามาถึง zodBody ซึ่งตอบ invalid_body ให้เอง
  //  — กฎเดิมทุกข้อยังอยู่ครบ แค่บังคับที่ชั้นที่เราคุมได้
  // ─────────────────────────────────────────────────────────────────────
  app.use(express.json({ strict: false, limit: '1mb' }));

  // body ไบนารีของ Yjs — ต้องลงทะเบียนที่นี่ ไม่ใช่ที่ controller เพราะ express
  // อ่าน body จบก่อนจะถึง route handler เสมอ
  app.use(express.raw({ type: 'application/octet-stream', limit: '4mb' }));
}

/** ตั้งค่าที่มีเฉพาะตอนรันจริง — เทสไม่ต้องการ (และไม่ควรมี) */
export function configureRuntime(app: NestExpressApplication, webOrigin: string): void {
  app.enableShutdownHooks();

  // ⚠️ ตัวเลข ไม่ใช่ true — `trust proxy = true` แปลว่า "เชื่อ X-Forwarded-For
  //    ทั้งสาย" ซึ่งทำให้ client ยัด IP อะไรก็ได้ลงไปเอง ค่า 1 = เชื่อ proxy
  //    ชั้นเดียว (nginx ที่อยู่หน้าเรา) ซึ่งตรงกับ docker-compose จริง
  app.set('trust proxy', 1);

  app.enableCors({ origin: webOrigin.split(',').map((o) => o.trim()), credentials: true });
}
