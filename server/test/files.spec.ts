// ═══════════════════════════════════════════════════════════════════════════
//  อัปโหลดรูป — เทสเฉพาะส่วนที่เป็นฟังก์ชันล้วน ไม่ต้องมีฐานข้อมูล/ดิสก์
//
//  ⚠️ จุดที่ต้องพิสูจน์คือด่านความปลอดภัย: content-type เป็นแค่คำอ้าง
//     ต้องดูไบต์จริง และชื่อไฟล์ที่เสิร์ฟต้องเดา/เดิน path ไม่ได้
// ═══════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';

import { MAX_IMAGE_BYTES, SAFE_NAME, validateImage } from '../src/files/files.service.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

describe('validateImage', () => {
  it('รับ png/jpeg ที่ไบต์ตรงกับชนิดที่อ้าง', () => {
    expect(validateImage(PNG, 'image/png')).toEqual({ ok: true, value: 'png' });
    expect(validateImage(JPEG, 'image/jpeg')).toEqual({ ok: true, value: 'jpg' });
  });

  it('ปฏิเสธเมื่อ header อ้าง png แต่ไบต์เป็น jpeg — content-type เป็นแค่คำอ้าง', () => {
    const result = validateImage(JPEG, 'image/png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('image_signature_mismatch');
  });

  it('ปฏิเสธชนิดนอกรายการ — โดยเฉพาะ svg ที่พก script ได้', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = validateImage(svg, 'image/svg+xml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported_image_type');
  });

  it('ปฏิเสธไฟล์ใหญ่เกินเพดาน', () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    const result = validateImage(huge, 'image/png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('image_too_large');
  });
});

describe('SAFE_NAME', () => {
  it('รับเฉพาะ uuid.นามสกุลในรายการ', () => {
    expect(SAFE_NAME.test('a1b2c3d4-e5f6-4a1b-8c2d-0123456789ab.png')).toBe(true);
    expect(SAFE_NAME.test('a1b2c3d4-e5f6-4a1b-8c2d-0123456789ab.webp')).toBe(true);
  });

  it('ปฏิเสธ path traversal และนามสกุลนอกรายการ', () => {
    expect(SAFE_NAME.test('../../etc/passwd')).toBe(false);
    expect(SAFE_NAME.test('a1b2c3d4-e5f6-4a1b-8c2d-0123456789ab.svg')).toBe(false);
    expect(SAFE_NAME.test('a1b2c3d4-e5f6-4a1b-8c2d-0123456789ab.png.html')).toBe(false);
  });
});
