import { HttpException, HttpStatus } from '@nestjs/common';

import type { AppError, ErrorKind, Result } from './result.js';

// ═══════════════════════════════════════════════════════════════════════════
//  ApiResponse — envelope เดียวกันทุก endpoint
//
//  ⚠️ รูปนี้เป็นสัญญากับ web/ อยู่แล้ว (ดู ApiEnvelope ใน web/src/lib/apiClient.ts)
//     เปลี่ยนชื่อ field ที่นี่ = แก้ฝั่งเว็บด้วยในคอมมิตเดียวกัน
// ═══════════════════════════════════════════════════════════════════════════
export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
}

export const envelopeOk = <T>(data: T, message?: string): ApiEnvelope<T> =>
  message === undefined ? { success: true, data } : { success: true, data, message };

export const envelopeFail = (message: string, code?: string): ApiEnvelope<never> =>
  code === undefined ? { success: false, message } : { success: false, message, code };

// ═══════════════════════════════════════════════════════════════════════════
//  Result → HTTP — "ที่เดียว"
//
//  controller ไม่ต้องรู้ว่า ErrorKind ไหนแปลงเป็น status อะไร แค่เรียก unwrap()
//  ทำให้ status code ทั้งระบบสอดคล้องกันโดยไม่ต้องพึ่งวินัย
//
//  ⚠️ "ไม่พบ" กับ "ไม่มีสิทธิ์เห็น" ต้องตอบ 404 ทั้งคู่
//     403 บอกผู้ใช้ว่า resource นี้มีอยู่จริง = leak การมีอยู่ข้าม tenant
//     (ที่ที่ตั้งใจตอบ 403 คือกรณีที่ผู้เรียก "เห็น" ของนั้นได้อยู่แล้ว เช่น
//      เป็นสมาชิก workspace แต่ role ต่ำเกินไป)
// ═══════════════════════════════════════════════════════════════════════════
const STATUS: Record<ErrorKind, HttpStatus> = {
  not_found: HttpStatus.NOT_FOUND,
  validation: HttpStatus.BAD_REQUEST,
  unauthorized: HttpStatus.UNAUTHORIZED,
  forbidden: HttpStatus.FORBIDDEN,
  conflict: HttpStatus.CONFLICT,
  unavailable: HttpStatus.SERVICE_UNAVAILABLE,
};

/** exception ที่ถือ envelope ไว้แล้ว — ApiExceptionFilter ส่งต่อตรง ๆ */
export class ApiException extends HttpException {
  constructor(error: AppError) {
    super(envelopeFail(error.message, error.code), STATUS[error.kind]);
  }
}

export const toApiException = (error: AppError): ApiException => new ApiException(error);

/**
 * แกะ Result ที่สำเร็จออกมา หรือ throw ให้ Nest ตอบ error ที่ถูกต้อง
 *
 * ⚠️ เรียกที่ controller เท่านั้น — service ที่เรียก service อื่นควรส่ง Result
 *    ต่อไปตามสายด้วย propagate() ไม่ใช่ throw กลางทาง ไม่งั้นเหตุผลข้อ 1 ของ
 *    การมี Result (อ่าน signature แล้วรู้ว่าล้มเหลวได้แบบไหน) หายไปทันที
 */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new ApiException(result.error);
  return result.value;
}
