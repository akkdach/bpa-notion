import { z } from 'zod';

export const createApiTokenSchema = z.object({
  /** ชื่อที่คนตั้งเอง เช่น "โน้ตบุ๊กสมชาย" — ไว้ให้รู้ว่าจะเพิกถอนใบไหน */
  name: z
    .string({ required_error: 'ตั้งชื่อ token ด้วย เช่นชื่อเครื่องที่จะใช้' })
    .trim()
    .min(1, 'ตั้งชื่อ token ด้วย เช่นชื่อเครื่องที่จะใช้')
    .max(100, 'ชื่อยาวเกิน 100 ตัวอักษร'),

  /** null / ไม่ส่ง = ไม่มีวันหมดอายุ */
  expiresInDays: z
    .number()
    .int('จำนวนวันต้องเป็นจำนวนเต็ม')
    .positive('จำนวนวันต้องมากกว่าศูนย์')
    .max(3650, 'จำนวนวันมากเกินไป')
    .nullish(),
});

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

/** ค่าจริงของ token — **แสดงครั้งเดียวเท่านั้น** ฐานข้อมูลเก็บแค่ hash จึงอ่านคืนไม่ได้อีก */
export interface CreatedApiTokenDto {
  id: string;
  name: string;
  token: string;
  last4: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface ApiTokenDto {
  id: string;
  name: string;
  /** สี่ตัวท้ายของค่าจริง — ไว้ให้คนจำใบได้ ไม่ใช่ความลับ */
  last4: string;
  status: 'active' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}
