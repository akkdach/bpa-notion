import { randomBytes } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
//  UUIDv7 — เรียงตามเวลาในตัว
//
//  ใช้กับ pages.id (และ api_tokens.id) แทน crypto.randomUUID() ซึ่งเป็น v4
//
//  ⚠️ ไม่ใช่เรื่องความสวย: id เป็น primary key และเป็นครึ่งหนึ่งของ
//     ux_pages_workspace_id_id ที่ตารางลูกทุกตัวอ้างถึง v4 สุ่มทั้งก้อนทำให้
//     การแทรกกระจายไปทั่ว btree — หน้าใหม่ทุกหน้าไปแตะ page ของ index คนละที่
//     v7 มี timestamp 48 บิตนำหน้า การแทรกจึงเกาะกลุ่มอยู่ปลายขวาของ index
//
//  ⚠️ ค่าที่ฐานสร้างเอง (DEFAULT gen_random_uuid()) ยังเป็น v4 อยู่ — ใช้เฉพาะ
//     เมื่อโค้ดไม่ได้ส่ง id มา ซึ่งสำหรับ pages เราส่งเสมอ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * รูปแบบตาม RFC 9562:
 *   48 บิตแรก  = มิลลิวินาทีตั้งแต่ epoch
 *   4 บิต      = version (7)
 *   12 บิต     = สุ่ม
 *   2 บิต      = variant (10)
 *   62 บิต     = สุ่ม
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  const now = Date.now();

  bytes.writeUIntBE(now, 0, 6);

  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
