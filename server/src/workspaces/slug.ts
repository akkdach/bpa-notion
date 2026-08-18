import { randomInt } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
//  Slug
//
//  ⚠️ ชื่อ workspace ส่วนใหญ่จะเป็นภาษาไทย ซึ่งแปลงเป็น slug แบบ ASCII ไม่ได้
//     ตรง ๆ วิธีที่มักเห็น (ถอดเสียงเป็นอักษรโรมัน) ต้องพึ่งตารางถอดเสียงที่ไม่มี
//     มาตรฐานเดียว และให้ผลที่คนไทยอ่านแล้วงงกว่าเดิม
//
//     ที่นี่จึงทำง่าย ๆ: เก็บส่วนที่เป็น ASCII ไว้ ถ้าไม่เหลืออะไรเลยก็ใช้ตัวสุ่ม
//     ชื่อจริงอยู่ในคอลัมน์ name อยู่แล้ว slug เป็นแค่ตัวระบุใน URL
//
//  ต้องผ่าน CHECK constraint: ^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$
//  แปลว่า 3–60 ตัว ขึ้นและลงท้ายด้วยตัวอักษร/ตัวเลข
// ═══════════════════════════════════════════════════════════════════════════

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 60;

/** ตัวอักษรที่อ่านไม่สับสน — ตัด 0/o/1/l/i ออก */
const RANDOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function slugFromName(name: string): string {
  const slug = slugify(name);

  // ชื่อไทยล้วนจะเหลือสตริงว่าง — ใช้คำนำหน้าที่อ่านออกแทน
  return slug.length >= SLUG_MIN_LENGTH ? slug : `ws-${randomSuffix(8)}`;
}

/** ทำให้ข้อความที่ผู้ใช้พิมพ์เองเป็น slug ที่ถูกกติกา — null ถ้าใช้ไม่ได้ */
export function normalizeSlug(candidate: string | null | undefined): string | null {
  if (!candidate || candidate.trim().length === 0) return null;

  const slug = slugify(candidate);
  return slug.length >= SLUG_MIN_LENGTH ? slug : null;
}

/** เติมท้ายเมื่อ slug ชนกัน — ต่อท้ายไม่ทับของเดิมเพื่อให้ยังพอเดาที่มาได้ */
export function slugWithSuffix(slug: string, suffixLength = 5): string {
  const suffix = `-${randomSuffix(suffixLength)}`;
  const room = SLUG_MAX_LENGTH - suffix.length;
  const head = slug.length <= room ? slug : slug.slice(0, room);

  return `${head.replace(/-+$/, '')}${suffix}`;
}

function slugify(input: string): string {
  // แยกวรรณยุกต์/เครื่องหมายออกจากตัวอักษรฐาน แล้วตัดทิ้ง
  // (จัดการภาษาที่ใช้อักษรโรมันมีเครื่องหมาย เช่น café → cafe)
  const stripped = input.normalize('NFD').replaceAll(/\p{Mn}/gu, '');

  let out = '';
  let lastWasDash = false;

  for (const ch of stripped) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) {
      out += ch;
      lastWasDash = false;
    } else if (ch >= 'A' && ch <= 'Z') {
      out += ch.toLowerCase();
      lastWasDash = false;
    } else if (!lastWasDash && out.length > 0) {
      // อักขระอื่น (รวมภาษาไทย) กลายเป็นขีดเดียว ไม่ซ้อนกัน
      out += '-';
      lastWasDash = true;
    }
  }

  const trimmed = out.replace(/^-+|-+$/g, '');
  return trimmed.length <= SLUG_MAX_LENGTH
    ? trimmed
    : trimmed.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, '');
}

const randomSuffix = (length: number): string =>
  Array.from({ length }, () => RANDOM_ALPHABET[randomInt(RANDOM_ALPHABET.length)]!).join('');
