import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
//  request / response ที่ boundary เท่านั้น — แถวในฐานห้ามข้ามเส้นนี้
//
//  ⚠️ รูปของ response เป็นสัญญากับ web/ อยู่แล้ว
//     (ดู AuthSession ใน web/src/features/auth/types.ts) เปลี่ยนชื่อ field
//     ที่นี่ = แก้ฝั่งเว็บในคอมมิตเดียวกัน
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ ไม่ใช้ z.string().email() โดยเจตนา — มันบังคับ ASCII
 *
 *    ระบบนี้รองรับอีเมลภาษาไทย (`สมชาย@บริษัท.local`) มาตั้งแต่ต้น คอลัมน์เป็น
 *    citext ที่ไม่มี CHECK รูปแบบ และ smoke test ก็ยืนยันข้อนี้ไว้ตั้งแต่ฝั่ง .NET
 *    (FluentValidation.EmailAddress() ในโหมด default ตรวจแค่ว่ามี @ ตรงกลาง)
 *
 *    การพอร์ตมาแล้วใช้ .email() ทำให้ผู้ใช้ที่มีอยู่สมัครและล็อกอินไม่ได้เลย —
 *    เป็นความพังที่เทสของเราเองจับไม่ได้ เพราะเทสทุกไฟล์ใช้อีเมล ASCII
 *
 *    กฎที่ใช้จึงเป็นกฎเดียวกับของเดิม: ต้องมี @ และต้องมีอะไรอยู่ทั้งสองข้าง
 */
const emailField = z
  .string({ required_error: 'กรุณากรอกอีเมล' })
  .trim()
  .min(1, 'กรุณากรอกอีเมล')
  .max(320, 'อีเมลยาวเกินไป')
  .refine((v) => /^[^@\s]+@[^@\s]+$/.test(v), 'รูปแบบอีเมลไม่ถูกต้อง');

export const registerSchema = z.object({
  email: emailField,

  // ─────────────────────────────────────────────────────────────────────
  //  ความยาวขั้นต่ำ 12 ตัว และไม่บังคับ "ต้องมีตัวพิมพ์ใหญ่/อักขระพิเศษ"
  //
  //  กฎ composition แบบนั้นดันให้คนตั้งรหัสแบบ Password1! ซึ่งเดาง่ายกว่า
  //  passphrase ยาว ๆ และ NIST เลิกแนะนำไปแล้ว ความยาวคือสิ่งที่ได้ผลจริง
  //
  //  ⚠️ นับเป็น "ตัวอักษร" ไม่ใช่ไบต์ (ไทยกินไบต์ละ 3) — argon2 ไม่มีเพดาน
  //     72 ไบต์แบบ bcrypt จึงไม่ต้อง pre-hash มาแก้เหมือนของเดิม
  // ─────────────────────────────────────────────────────────────────────
  password: z
    .string({ required_error: 'กรุณากรอกรหัสผ่าน' })
    .min(12, 'รหัสผ่านต้องยาวอย่างน้อย 12 ตัวอักษร')
    .max(200, 'รหัสผ่านยาวเกินไป'),

  name: z
    .string({ required_error: 'กรุณากรอกชื่อ' })
    .trim()
    .min(1, 'กรุณากรอกชื่อ')
    .max(200, 'ชื่อยาวเกินไป'),
});

export const loginSchema = z.object({
  // ⚠️ login ไม่ตรวจรูปแบบ/ความยาวรหัสผ่าน — ตรวจแล้วจะบอกใบ้เกณฑ์ที่ใช้ตอน
  //    สมัคร และผู้ใช้ที่ตั้งรหัสไว้ก่อนเปลี่ยนกฎจะ login ไม่ได้
  email: z.string().min(1, 'กรุณากรอกอีเมล'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'ไม่มี refresh token'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;

export interface UserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  locale: string;
  /** "human" หรือ "agent" — ใช้แยกงานที่ AI ทำออกจากงานที่คนทำ */
  kind: string;
}

export interface WorkspaceSummaryDto {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  role: string;
}

export interface AuthResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: UserDto;
  workspaces: WorkspaceSummaryDto[];
}
