import { Injectable, Logger } from '@nestjs/common';
import argon2 from 'argon2';

// ═══════════════════════════════════════════════════════════════════════════
//  PasswordService — argon2id ไม่ใช่ bcrypt
//
//  ของเดิมใช้ BCrypt.Net-Next work factor 12 การเริ่มฐานใหม่ทำให้เลือกได้อิสระ
//  เพราะไม่มี hash เดิมที่ต้องอ่านต่อ (ดู PLAN-node.md "เรื่องที่ยากจริง")
//
//  argon2id ดีกว่าตรงที่มันแพงทั้ง "เวลา" และ "หน่วยความจำ" — bcrypt แพงแต่
//  เวลาอย่างเดียว จึงถูก GPU/ASIC เร่งได้มาก OWASP แนะนำ argon2id เป็นอันดับแรก
//
//  ⚠️ bcrypt มีเพดาน 72 ไบต์ที่ตัดรหัสผ่านทิ้งเงียบ ๆ — ไทยกินไบต์ละ 3 ตัว
//     passphrase ไทย 24 ตัวอักษรก็ชนเพดานแล้ว ของเดิมต้อง pre-hash ด้วย
//     SHA-384 มาแก้ (EnhancedHashPassword) argon2 ไม่มีเพดานนี้ ปัญหาหายไปเอง
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ค่าตาม OWASP Password Storage Cheat Sheet สำหรับ argon2id
 *
 * ⚠️ ห้ามลดค่าพวกนี้เพื่อให้เทสเร็วขึ้น — hash ที่ผลิตด้วยพารามิเตอร์ต่างกัน
 *    ยัง verify ได้ (ค่าถูกฝังอยู่ในสตริง hash) แต่ถ้า production เผลอใช้ค่า
 *    ของเทส รหัสผ่านทั้งฐานจะอ่อนลงโดยไม่มีอาการอะไรเลย
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  /**
   * ⚠️ คืน false ไม่ throw เมื่อ hash ในฐานเสียรูป
   *
   *    argon2.verify โยน error เมื่อสตริงไม่ใช่ hash ที่อ่านได้ ถ้าปล่อยหลุด
   *    ออกไป login จะตอบ 500 ซึ่งบอกผู้โจมตีว่า "บัญชีนี้มีอยู่จริงแต่ข้อมูลเสีย"
   *    — ต่างจาก 401 ของบัญชีที่ไม่มีอยู่ กลายเป็นช่องนับบัญชีอีกทาง
   */
  async verify(password: string, hash: string): Promise<boolean> {
    try {
      // ⚠️ ไม่ส่ง OPTIONS ที่นี่ และไม่ใช่การลืม — พารามิเตอร์ (m, t, p, salt)
      //    ถูกฝังอยู่ในสตริง hash อยู่แล้ว argon2.verify จึงอ่านจากตรงนั้น
      //    ผลพลอยได้: hash เก่าที่ผลิตด้วยค่าอื่นยัง verify ได้ ถ้าวันหนึ่ง
      //    ต้องเพิ่มความแข็งของ OPTIONS ผู้ใช้เดิมจะไม่ถูกล็อกออกจากระบบ
      return await argon2.verify(hash, password);
    } catch (error) {
      this.logger.warn(`verify รหัสผ่านไม่สำเร็จเพราะ hash ในฐานอ่านไม่ได้: ${String(error)}`);
      return false;
    }
  }

  /**
   * เผาเวลาให้เท่ากับการ verify จริง เมื่อไม่พบบัญชี
   *
   * ⚠️ ถ้า login คืนค่าทันทีตอนไม่พบอีเมล อีเมลที่ไม่มีในระบบจะตอบเร็วกว่า
   *    อีเมลที่มีอย่างชัดเจน (argon2id ที่ 19 MiB ≈ 50–100 ms) ซึ่งพอจะไล่หา
   *    รายชื่ออีเมลที่มีอยู่จริงได้จากเวลาตอบสนองล้วน ๆ
   *
   *    ต้อง verify กับ hash ที่ "พารามิเตอร์เดียวกัน" ไม่ใช่แค่ hash อะไรก็ได้
   *    ไม่งั้นเวลาที่ใช้ก็ยังต่างกันจนเป็น timing signal อีกทาง — DUMMY_HASH
   *    จึงถูกสร้างจาก OPTIONS ชุดเดียวกันตอนบูต
   */
  async burnTime(password: string): Promise<void> {
    await this.verify(password, await this.dummyHash());
  }

  private dummy: Promise<string> | undefined;

  private dummyHash(): Promise<string> {
    // hash ครั้งเดียวต่อ process แล้วใช้ซ้ำ — การ hash ใหม่ทุกครั้งจะเสียเวลา
    // เป็นสองเท่าของ verify จริง ซึ่งเป็น timing signal กลับด้าน
    this.dummy ??= argon2.hash('รหัสผ่านหลอกสำหรับถ่วงเวลา ไม่ใช่ของใคร', OPTIONS);
    return this.dummy;
  }
}
