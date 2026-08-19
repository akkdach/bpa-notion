import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
//  env — อ่านครั้งเดียวตอนบูต แล้วพังทันทีถ้าไม่ครบ
//
//  ⚠️ ห้ามอ่าน process.env จากที่อื่นในโค้ด — env ที่หายไปต้องทำให้ process
//     ไม่ขึ้นเลย ไม่ใช่ทำให้ request ที่ 500 ในอีกสามชั่วโมงข้างหน้า
// ═══════════════════════════════════════════════════════════════════════════

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5081),

  /**
   * connection string ของ runtime — ต้องเป็น role pm_app เท่านั้น
   *
   * ⚠️ ถ้าใส่ postgres (superuser) ตรงนี้ RLS policy ทุกข้อจะถูกข้ามเงียบ ๆ
   *    และระบบจะ "ดูเหมือนทำงานได้" จนกว่าจะมี tenant ที่สอง
   *    → assertRuntimeRoleIsSafe() ใน db.service.ts ตรวจตอนบูต
   */
  DATABASE_URL: z.string().url(),

  // ⚠️ ไม่มี DATABASE_ADMIN_URL ที่นี่โดยเจตนา — runtime ไม่ต้องรู้จักรหัสของ
  //    owner และไม่ควรรู้ด้วย ถ้าใส่ไว้ที่นี่ container ที่เสิร์ฟ request จะ
  //    บูตไม่ขึ้นจนกว่าจะได้รหัส owner ซึ่งเป็นการบังคับให้แจกของที่ไม่ควรแจก
  //
  //    สคริปต์ที่ต้องใช้จริง (scripts/db-setup.ts, drizzle.config.ts) อ่านเองและ
  //    พังเองถ้าไม่มี

  /** ขนาด pool — เทส RLS ตั้งเป็น 1 เพื่อบังคับให้ connection ถูก reuse */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  /**
   * ⚠️ อย่างน้อย 32 ไบต์ — HMAC-SHA256 ต้องการ key 256 บิต
   *
   *    ถ้าสั้นกว่านี้ library จะยอมเซ็นให้ (ไม่ error) แต่ token ที่ได้อ่อนกว่า
   *    ที่อัลกอริทึมสัญญาไว้ และไม่มีอะไรส่งเสียงเลย จึงต้องดักที่นี่
   *    สร้างใหม่: openssl rand -base64 48
   */
  JWT_SECRET: z.string().min(32, 'ต้องยาวอย่างน้อย 32 ตัวอักษร (openssl rand -base64 48)'),
  JWT_ISSUER: z.string().min(1),
  JWT_EXPIRES_IN: z.string().default('24h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  /** origin ที่เรียก API ได้ — คั่นด้วยจุลภาคเมื่อมีหลายอัน */
  WEB_ORIGIN: z.string().default('http://localhost'),

  /**
   * โฟลเดอร์เก็บไฟล์รูปที่ผู้ใช้อัปโหลด — บน docker ต้องเป็น path ที่ mount
   * volume ไว้ ไม่งั้นไฟล์หายทุกครั้งที่ recreate container
   */
  UPLOAD_DIR: z.string().default('uploads'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`);
    throw new Error(`ตั้งค่า environment ไม่ครบ:\n${lines.join('\n')}`);
  }

  cached = parsed.data;
  return cached;
}

/** สำหรับเทสที่ต้องโหลดใหม่ด้วยค่าอื่น */
export function resetEnvCache(): void {
  cached = undefined;
}
