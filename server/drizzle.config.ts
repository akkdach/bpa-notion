import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';

// ⚠️ drizzle-kit ต่อด้วยบัญชี owner ไม่ใช่ pm_app — pm_app สร้างตารางไม่ได้
//    โดยเจตนา (role ที่แก้ schema ได้คือ role ที่ปิด RLS ของตัวเองได้)
const url = process.env['DATABASE_ADMIN_URL'];
if (!url) throw new Error('ต้องมี DATABASE_ADMIN_URL — cp .env.example .env');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  // ─────────────────────────────────────────────────────────────────────
  //  ⚠️ ห้ามใช้ `drizzle-kit push` กับฐานนี้เด็ดขาด
  //
  //  generate เทียบ schema.ts กับ snapshot ของตัวเองใน drizzle/meta จึงมองไม่
  //  เห็นของใน sql/objects.sql เลย = ปลอดภัย
  //  แต่ push เทียบกับ "ฐานจริง" แล้วจะเห็น RLS policy, partial index และ
  //  PGroonga index เป็นของแปลกปลอมที่ไม่มีใน schema.ts แล้วเสนอ DROP ให้
  //  — ซึ่งแปลว่าถอด tenant isolation ออกทั้งระบบด้วยคำสั่งเดียว
  //
  //  ทางที่ถูกคือ generate → ตรวจ SQL ที่ได้ → db:setup (ดู package.json)
  // ─────────────────────────────────────────────────────────────────────
  verbose: true,
  strict: true,
});
