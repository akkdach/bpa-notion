// ═══════════════════════════════════════════════════════════════════════════
//  Result<T> — สำหรับ failure ที่ "คาดไว้แล้ว"
//
//  "ไม่พบหน้า", "slug ซ้ำ", "รหัสผ่านผิด" คือ outcome ไม่ใช่ exception
//  exception เก็บไว้ใช้กับบั๊กจริง ๆ เท่านั้น
//
//  ── ต่างจากฝั่ง C# ตรงนี้ ────────────────────────────────────────────────
//  ของเดิมให้เหตุผลไว้สองข้อ ข้อแรกยังจริงทั้งหมด ข้อสองไม่จริงแล้ว:
//
//    1. อ่าน signature แล้วรู้เลยว่าฟังก์ชันนี้ล้มเหลวได้แบบไหน  ← ยังใช่
//    2. throw/catch ใน hot path (ทุก keystroke) แพง                ← ไม่ใช่แล้ว
//
//  ข้อสองหายไปเพราะ hot path ของ Yjs ย้ายไปอยู่บน WebSocket ไม่ผ่าน HTTP
//  แล้ว การ throw จึงเกิดแค่ครั้งเดียวต่อ request ที่ล้มเหลว ที่ขอบ controller
//
//  ผลคือ service ยังคืน Result (ได้ข้อ 1 มาเต็ม ๆ) แต่ controller เรียก
//  unwrap() ซึ่ง throw HttpException ให้ Nest จัดการต่อตามปกติ — ไม่ต้องมี
//  interceptor พิเศษมาแกะ และ Swagger/filter ทำงานเหมือน endpoint ทั่วไป
// ═══════════════════════════════════════════════════════════════════════════

/** ชนิดของความล้มเหลว — แปลงเป็น HTTP status ที่เดียวใน api-response.ts */
export type ErrorKind =
  /** ไม่พบ — หรือมีแต่ผู้ใช้ไม่มีสิทธิ์เห็น (ตอบ 404 ทั้งสองกรณี) */
  | 'not_found'
  /** input ไม่ถูกต้อง → 400 */
  | 'validation'
  /** ยังไม่ได้ login → 401 */
  | 'unauthorized'
  /** login แล้วแต่ไม่มีสิทธิ์ → 403 */
  | 'forbidden'
  /** ชนกับ state ปัจจุบัน เช่น slug ซ้ำ → 409 */
  | 'conflict'
  /** ระบบภายนอกล้ม → 503 */
  | 'unavailable';

export interface AppError {
  readonly kind: ErrorKind;
  readonly message: string;
  readonly code?: string;
}

/**
 * ⚠️ ฝั่งล้มเหลวเป็น type ของตัวเอง ไม่ใช่แค่ member ของ union
 *
 *    ทำให้ `err.notFound(...)` มี `.error` ให้อ่านได้ทันทีโดยไม่ต้องแคบชนิดก่อน
 *    (interceptor ต้องใช้เพื่อสร้าง ApiException) และยัง assign เข้า Result<T>
 *    ของ T อะไรก็ได้ตามปกติ
 */
export interface Failure {
  readonly ok: false;
  readonly error: AppError;
}

export type Success<T> = { readonly ok: true; readonly value: T };
export type Result<T> = Success<T> | Failure;

/** command ที่ไม่มีค่ากลับ */
export type VoidResult = Result<null>;

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const okVoid = (): VoidResult => ({ ok: true, value: null });

const fail = (kind: ErrorKind) => (message: string, code?: string): Failure => ({
  ok: false,
  error: code === undefined ? { kind, message } : { kind, message, code },
});

export const err = {
  notFound: fail('not_found'),
  validation: fail('validation'),
  unauthorized: fail('unauthorized'),
  forbidden: fail('forbidden'),
  conflict: fail('conflict'),
  unavailable: fail('unavailable'),
};

/**
 * ส่งต่อความล้มเหลวจาก Result ตัวอื่นโดยไม่ต้องแกะ error ออกมาเอง
 *
 * TypeScript แคบชนิดให้เองหลัง `if (!r.ok) return propagate(r)` จึงไม่ต้อง
 * cast ที่จุดเรียก
 */
export const propagate = (result: Failure): Failure => result;
