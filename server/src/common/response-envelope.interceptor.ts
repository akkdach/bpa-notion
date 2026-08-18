import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

import { type ApiEnvelope, envelopeOk } from './api-response.js';

/**
 * ห่อค่าที่ controller คืนด้วย envelope มาตรฐาน
 *
 * ทำที่นี่ที่เดียวแทนที่จะให้ทุก controller ประกอบ envelope เอง — endpoint ที่
 * ลืมห่อคือ endpoint ที่ฝั่งเว็บ unwrap() ไม่ผ่าน และมันจะพังตอน runtime
 * เท่านั้น ไม่ใช่ตอนคอมไพล์
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<ApiEnvelope<unknown> | undefined> {
    const response = ctx.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data: unknown) => {
        // ⚠️ endpoint ที่ตอบไบนารีเอง (GET /pages/:id/ydoc) เขียน response ไป
        //    แล้วด้วย @Res() — ห่อซ้ำจะได้ "Cannot set headers after they are
        //    sent" ซึ่งโผล่เป็น 500 ที่ชี้ไปคนละเรื่องกับสาเหตุจริง
        if (response.headersSent) return undefined;
        return envelopeOk(data ?? null);
      }),
    );
  }
}
