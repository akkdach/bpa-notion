import { z } from 'zod';

import { PAGE_STATUSES, type PageKind, type PageRole, type PageStatus } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Pages — request / response ที่ boundary เท่านั้น
// ═══════════════════════════════════════════════════════════════════════════

/**
 * สถานะงาน
 *
 * ⚠️ รับ '' ด้วยแล้วแปลงเป็น null เพื่อให้เข้ากับ client เดิม — ฝั่ง .NET ใช้
 *    สตริงว่างแทน "ล้างสถานะ" ส่วน null แปลว่า "ไม่แตะ" ที่นี่ทั้ง null และ ''
 *    หมายถึงล้าง ส่วน "ไม่แตะ" คือไม่ส่ง field มาเลย ซึ่งชัดเจนกว่า
 */
const statusField = z
  .union([z.enum(PAGE_STATUSES), z.literal(''), z.null()])
  .transform((v): PageStatus | null => (v === '' || v === null ? null : v));

export const createPageSchema = z.object({
  /** null / ไม่ส่ง = หน้าระดับบนสุด */
  parentId: z.string().uuid().nullish(),

  title: z.string().max(2000, 'ชื่อหน้ายาวเกินไป').nullish(),
  icon: z.string().max(200).nullish(),

  /** แทรกต่อจากหน้านี้ — ไม่ส่ง = ต่อท้ายสุด */
  afterPageId: z.string().uuid().nullish(),

  /**
   * สถานะงานเริ่มต้น
   *
   * รับตอนสร้างเพื่อให้ "สร้างงานพร้อมสถานะ" เป็น request เดียว ก่อนหน้านี้
   * ผู้เรียก (mcp/) ต้อง POST แล้ว PATCH ตาม ซึ่งไม่ atomic — ล้มกลางทางแล้ว
   * เหลือหน้าที่ไม่มีสถานะค้างอยู่ในระบบ
   */
  status: statusField.optional(),
});

export const updatePageSchema = z
  .object({
    title: z.string().max(2000, 'ชื่อหน้ายาวเกินไป').optional(),

    // ⚠️ null = ล้างค่า · ไม่ส่ง = ไม่แตะ
    //    ของเดิมแยกสองอย่างนี้ไม่ออก (null แปลว่า "ไม่แตะ") จึงล้างไอคอนไม่ได้เลย
    icon: z.string().max(200).nullable().optional(),
    coverUrl: z.string().max(1000).nullable().optional(),
    status: statusField.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'ไม่มีอะไรให้แก้' });

export const movePageSchema = z.object({
  /** parent ใหม่ — null / ไม่ส่ง = ย้ายขึ้นระดับบนสุด */
  parentId: z.string().uuid().nullish(),
  /** วางต่อจากหน้านี้ในกลุ่มพี่น้องใหม่ — ไม่ส่ง = ท้ายสุด */
  afterPageId: z.string().uuid().nullish(),
});

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type MovePageInput = z.infer<typeof movePageSchema>;

export interface PageDto {
  id: string;
  parentId: string | null;
  ancestorIds: string[];
  depth: number;
  rank: string;
  kind: PageKind;
  title: string;
  icon: string | null;
  coverUrl: string | null;
  status: PageStatus | null;
  accessRootId: string;
  myRole: PageRole;
  /**
   * ⚠️ ส่งเป็น id ไม่ใช่ชื่อ — การ resolve ชื่อต้อง join users ซึ่ง PageNodeDto
   *    ใช้โหลด tree ทั้ง workspace ทีเดียว จ่ายค่า join ต่อทุกโหนดไม่คุ้ม
   *    ฝั่งที่ต้องโชว์ชื่อคน (ฟีดกิจกรรม) เป็นลิสต์ที่มีขอบเขต จึง resolve ที่นั่น
   */
  lastEditedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** โหนดใน sidebar — เบากว่า PageDto เพราะโหลดทั้ง tree ทีเดียว */
export interface PageNodeDto {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  status: PageStatus | null;
  rank: string;
  depth: number;
  hasChildren: boolean;
  lastEditedBy: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

/** @param affectedDescendants จำนวนลูกหลานที่ถูกอัปเดตใน UPDATE เดียว */
export interface MoveResultDto {
  page: PageDto;
  affectedDescendants: number;
}

export interface RepairResultDto {
  fixedAncestors: number;
  fixedAccessRoots: number;
}
