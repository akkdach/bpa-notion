import { z } from 'zod';

import type { PageRole } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  projection ที่ client แกะจาก Y.Doc ส่งกลับมา
//
//  เซิร์ฟเวอร์อ่าน Yjs ไม่ได้ในทางปกติ (เก็บเป็น bytea ทึบ ๆ) จึงต้องให้ client
//  เป็นคนแปลงเป็น plain text ข้อมูลนี้ derived ทั้งหมด — ถ้าล้าสมัยผลค้นหา
//  ล้าสมัย แต่ไม่มีอะไรเสียหายและสร้างใหม่ได้เสมอ
// ═══════════════════════════════════════════════════════════════════════════
export const projectionSchema = z.object({
  title: z.string().max(2000).nullish(),
  plainText: z.string().nullish(),

  /**
   * id ของหน้าที่ถูก mention ในเนื้อหา — เขียนทับทั้งชุดต่อหนึ่งหน้า
   *
   * ⚠️ ไม่ส่ง = คงลิงก์เดิมไว้ (client รุ่นเก่าที่ยังไม่รู้จักช่องนี้)
   *    [] = ส่งมาแต่ไม่มีลิงก์เลย ให้ลบทั้งหมด
   *    ความต่างนี้สำคัญ ไม่งั้นการอัปเดต client จะล้างลิงก์ของทุกหน้าทิ้ง
   */
  links: z.array(z.string().uuid()).nullish(),
});

export const appendParagraphsSchema = z.object({
  /**
   * ข้อความ ย่อหน้าละหนึ่งรายการ — ขึ้นบรรทัดในตัวจะถูกแตกเป็นคนละย่อหน้าให้
   * (BlockNote ไม่มีโครงรองรับ newline ภายในย่อหน้าเดียว)
   */
  paragraphs: z.array(z.string()).min(1, 'ไม่มีย่อหน้าให้เขียน'),
});

export const appendMarkdownSchema = z.object({
  /**
   * เนื้อหาเป็น markdown — หัวข้อ รายการ คำพูดอ้างอิง บล็อกโค้ด เส้นคั่น
   * ` ```mermaid ` แสดงเป็นแผนภาพจริงในเบราว์เซอร์
   */
  markdown: z.string().min(1, 'ไม่มีเนื้อหาให้เขียน'),
});

// ⚠️ ไม่มี schema ของ update/snapshot — สองเส้นนั้นรับ "ไบต์ดิบ" ใน body
//    (application/octet-stream) ไม่ใช่ JSON ส่วน seq/clientId มาทาง query
//    string ดู web/src/features/editor/service/docApi.ts ซึ่งเป็นสัญญาที่มีอยู่แล้ว

export type ProjectionInput = z.infer<typeof projectionSchema>;
export type AppendParagraphsInput = z.infer<typeof appendParagraphsSchema>;
export type AppendMarkdownInput = z.infer<typeof appendMarkdownSchema>;

export interface DocumentBootstrapDto {
  pageId: string;
  role: PageRole;
  frames: Buffer;
  headSeq: number;
  snapshotUpToSeq: number;
  updatesSinceSnapshot: number;
  shouldCompact: boolean;
}

export interface SnapshotResultDto {
  upToSeq: number;
  byteSize: number;
  prunedUpdates: number;
  /** true = snapshot ถูกเก็บแบบยังไม่เชื่อ ไม่ได้ใช้เสิร์ฟและไม่ได้ prune */
  pruneSkipped: boolean;
}

export interface AppendResultDto {
  seq: number;
  blocks: number;
  warnings: string[];
}

export interface BacklinkDto {
  id: string;
  title: string;
  icon: string | null;
  updatedAt: string;
}

/**
 * ความน่าเชื่อถือของ plain text ที่คืนไป
 *
 * ⚠️ เป็นสามสถานะไม่ใช่ boolean โดยเจตนา — "ไม่เคยมีใครเปิด" ต่างจาก "หน้าว่าง"
 *    ถ้าไม่แยก ผู้เรียก (โดยเฉพาะ AI) จะสรุปว่าหน้านี้ไม่มีเนื้อหาแล้วเขียนทับ
 */
export type ContentFreshness = 'never' | 'from_document';

export interface PageContentDto {
  id: string;
  title: string;
  bodyText: string;
  freshness: ContentFreshness;
  pageUpdatedAt: string;
  /**
   * เวลาที่ plain text ถูกเขียนล่าสุด — null เมื่อ freshness = never
   *
   * ถ้าค่านี้เก่ากว่า pageUpdatedAt แปลว่าอาจมีการแก้ที่ยังไม่สะท้อนมาถึงข้อความนี้
   * ผู้เรียกเทียบเองได้ เราไม่สรุปให้เพราะ pageUpdatedAt ขยับตอนเปลี่ยนสถานะ/
   * ไอคอนด้วย ซึ่งไม่ได้แปลว่าเนื้อหาเปลี่ยน
   */
  projectionUpdatedAt: string | null;
}
