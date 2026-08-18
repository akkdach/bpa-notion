import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { type ApiEnvelope, envelopeFail } from './api-response.js';
import { loadEnv } from '../config/env.js';

// ═══════════════════════════════════════════════════════════════════════════
//  ApiExceptionFilter
//
//  exception ที่ "ไม่ใช่" HttpException มาถึงที่นี่ = บั๊ก
//  (failure ที่คาดไว้ให้คืน Result แล้ว unwrap ที่ controller — ดู result.ts)
//
//  หน้าที่: log ให้ครบ แล้วตอบ envelope เดียวกับ endpoint อื่น โดยไม่หลุด
//  stack trace หรือ SQL ออกไปข้างนอกตอน production
// ═══════════════════════════════════════════════════════════════════════════
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  private readonly isDevelopment = loadEnv().NODE_ENV !== 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    // ─────────────────────────────────────────────────────────────────────
    //  body ที่ parse ไม่ได้
    //
    //  ⚠️ error นี้เกิดใน middleware ของ express (body-parser) ก่อนจะถึง pipe
    //     ของเรา — zodBody จึงไม่มีทางเห็นมันเลย ถ้าไม่ดักตรงนี้ผู้เรียกจะได้
    //     code ทั่วไป (http_error) แทนที่จะเป็น invalid_body ที่ client เดิมใช้
    //     แยกกรณี "ส่ง JSON มาผิดรูป" ออกจาก "field ไม่ผ่านกฎ"
    //
    //     express strict mode ปฏิเสธ JSON ที่ไม่ใช่ object/array ด้วย เช่น
    //     `null` เปล่า ๆ ซึ่งเป็นสิ่งที่ smoke test ยิงมา
    // ─────────────────────────────────────────────────────────────────────
    if (isBodyParseFailure(exception)) {
      response.status(400).json(envelopeFail('อ่านข้อมูลใน request body ไม่ได้ — ต้องเป็น JSON', 'invalid_body'));
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(normalize(exception));
      return;
    }


    // traceId ให้ผู้ใช้แจ้งกลับมาได้ แล้วเราไปหาใน log ตัวเดียวกัน
    const traceId = randomTraceId();

    this.logger.error(
      `${request.method} ${request.originalUrl} ล้มเหลวโดยไม่ได้ตั้งใจ (traceId=${traceId})`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    const message = this.isDevelopment
      ? exception instanceof Error
        ? exception.message
        : String(exception)
      : `เกิดข้อผิดพลาดภายในระบบ (traceId: ${traceId})`;

    response.status(500).json(envelopeFail(message, 'internal_error'));
  }
}

/**
 * HttpException มาได้สองแบบ: ที่เราสร้างเอง (ถือ envelope อยู่แล้ว) และที่
 * Nest สร้างให้ (404 route ไม่มีจริง, 413 payload ใหญ่เกิน) — แบบหลังต้อง
 * แปลงเป็น envelope ไม่งั้นฝั่งเว็บจะเจอ response หน้าตาคนละอย่างเฉพาะ
 * error ที่ไม่ได้มาจากโค้ดของเรา ซึ่งเป็นกรณีที่ debug ยากที่สุดพอดี
 */
function normalize(exception: HttpException): ApiEnvelope<unknown> {
  const body = exception.getResponse();

  if (typeof body === 'object' && body !== null && 'success' in body) {
    return body as ApiEnvelope<unknown>;
  }

  const message =
    typeof body === 'string'
      ? body
      : typeof body === 'object' && body !== null && 'message' in body
        ? String((body).message)
        : exception.message;

  return envelopeFail(message, 'http_error');
}

const randomTraceId = (): string => Math.random().toString(36).slice(2, 10);

/**
 * body-parser ติด type ไว้กับ error ของมันเอง — เชื่อถือได้กว่าดูข้อความ
 *
 * ⚠️ ต้องไล่ดู cause ด้วย: Nest ห่อ error ของ middleware เป็น BadRequestException
 *    แล้วเก็บตัวจริงไว้ที่ cause — ถ้าดูแค่ตัวนอกจะไม่เจอ type เลย
 */
function isBodyParseFailure(exception: unknown): boolean {
  let current: unknown = exception;

  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth++) {
    const e = current as { type?: string; status?: number; cause?: unknown };
    if (e.type === 'entity.parse.failed') return true;
    if (current instanceof SyntaxError && e.status === 400) return true;
    current = e.cause;
  }

  return false;
}
