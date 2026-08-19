import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { loadEnv } from '../config/env.js';
import { err, ok, type Result } from '../common/result.js';

// ═══════════════════════════════════════════════════════════════════════════
//  ไฟล์รูปที่ผู้ใช้อัปโหลด
//
//  เก็บลงดิสก์ตรง ๆ ไม่มีตารางในฐานข้อมูล — ชื่อไฟล์คือ UUID สุ่มซึ่งทำหน้าที่
//  เป็น capability URL: รู้ URL = เห็นรูป เดา URL ไม่ได้ (แบบเดียวกับลิงก์ไฟล์
//  ของ Notion/S3) จึงเสิร์ฟแบบ @Public ได้โดยไม่ต้องพก token ใน <img src>
//  (เบราว์เซอร์ไม่ส่ง Authorization header ตอนโหลดรูปอยู่แล้ว)
//
//  ⚠️ ไฟล์ไม่ถูกลบตามหน้า — หน้าถูกลบ/แก้แล้วรูปยังอยู่ เหมือนบันทึกที่
//     append-only การเก็บกวาดเป็นงานอนาคต (ต้องมี reference counting ก่อน)
// ═══════════════════════════════════════════════════════════════════════════

/** เพดานขนาดรูปต่อไฟล์ — parser ใน bootstrap.ts ตั้งไว้หลวมกว่านี้ (12MB) โดยเจตนา */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * ชนิดรูปที่รับ — จงใจไม่มี image/svg+xml: SVG มี <script> ได้ ถ้าผู้ใช้เปิด
 * URL ตรง ๆ ในแท็บใหม่ script จะรันบน origin ของแอป = stored XSS
 */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * magic bytes ต่อชนิด — content-type header เป็นแค่คำอ้างของผู้ส่ง
 * ต้องดูไบต์จริงก่อนเชื่อ ไม่งั้นใครก็ส่ง HTML มาในเสื้อคลุม image/png ได้
 */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8',
  'image/webp': (b) =>
    b.length > 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** ชื่อไฟล์ที่เสิร์ฟได้ — UUID + นามสกุลจากตาราง EXTENSIONS เท่านั้น กัน path traversal ตั้งแต่รูปแบบ */
export const SAFE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;

/** ตรวจรูปก่อนเขียนดิสก์ — คืนนามสกุลไฟล์เมื่อผ่าน (แยกเป็นฟังก์ชันล้วนให้เทสได้ตรง ๆ) */
export function validateImage(body: Buffer, mime: string): Result<string> {
  const ext = EXTENSIONS[mime];
  if (ext === undefined) {
    return err.validation(
      `ชนิดรูปต้องเป็น ${Object.keys(EXTENSIONS).join(', ')} — ได้ "${mime}"`,
      'unsupported_image_type',
    );
  }

  if (body.length > MAX_IMAGE_BYTES) {
    return err.validation(`รูปใหญ่เกิน ${MAX_IMAGE_BYTES / 1024 / 1024} MB`, 'image_too_large');
  }

  if (!SIGNATURES[mime]!(body)) {
    return err.validation(`เนื้อไฟล์ไม่ใช่ ${mime} จริง — header กับไบต์ในไฟล์ไม่ตรงกัน`, 'image_signature_mismatch');
  }

  return ok(ext);
}

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private readonly dir = path.resolve(loadEnv().UPLOAD_DIR);

  async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.logger.log(`เก็บไฟล์อัปโหลดที่ ${this.dir}`);
  }

  async saveImage(body: Buffer, mime: string): Promise<Result<{ url: string }>> {
    const validated = validateImage(body, mime);
    if (!validated.ok) return validated;

    const name = `${randomUUID()}.${validated.value}`;
    await writeFile(path.join(this.dir, name), body);

    // path สัมพัทธ์ same-origin — เบราว์เซอร์ resolve กับ origin ที่เปิดอยู่เอง
    // จึงใช้ได้ทั้งหลัง nginx (:4090) และ dev ตรง ๆ โดยไม่ฝัง host ลงเอกสาร
    return ok({ url: `/api/v1/files/${name}` });
  }

  /** คืน path จริงบนดิสก์ — ตรวจรูปแบบชื่อก่อนแตะ filesystem เสมอ */
  async resolve(name: string): Promise<Result<string>> {
    if (!SAFE_NAME.test(name)) {
      return err.notFound('ไม่พบไฟล์', 'file_not_found');
    }

    const filePath = path.join(this.dir, name);
    try {
      await access(filePath);
    } catch {
      return err.notFound('ไม่พบไฟล์', 'file_not_found');
    }

    return ok(filePath);
  }
}
