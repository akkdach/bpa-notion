// ═══════════════════════════════════════════════════════════════════════════
//  ค่า enum ที่เก็บใน DB เป็น text (มี CHECK constraint คุมอยู่)
//
//  ไม่ใช่ int เพราะ:
//    · อ่าน SQL ดิบแล้วเข้าใจได้ทันที — เรามี raw SQL เยอะ (PGroonga, CTE)
//    · แทรกค่าใหม่ตรงกลางแล้วความหมายของข้อมูลเดิมไม่เปลี่ยน
//
//  ⚠️ ทุกรายการในไฟล์นี้ต้องตรงกับ CHECK constraint ใน sql/objects.sql เป๊ะ ๆ
//     เพิ่มค่าใหม่ = แก้สองที่ในคอมมิตเดียว (มีเทสเทียบให้ใน test/domain.spec.ts)
// ═══════════════════════════════════════════════════════════════════════════

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PAGE_ROLES = ['full', 'editor', 'commenter', 'viewer'] as const;
export type PageRole = (typeof PAGE_ROLES)[number];

export const PAGE_KINDS = ['page', 'database', 'db_row'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/**
 * ⚠️ ไม่มี 'group' โดยเจตนา — เคยมีค่านี้พร้อม CHECK constraint ที่ยอมรับ
 *    แต่ **ไม่มีตาราง groups/group_members อยู่จริงเลย** ค่านั้นจึงเป็นสถานะที่
 *    ระบบไม่มีทางสร้างได้ และทำให้ resolver มี branch ตายค้างไว้
 */
export const ACL_SUBJECT_TYPES = ['user', 'workspace'] as const;
export type AclSubjectType = (typeof ACL_SUBJECT_TYPES)[number];

/**
 * ⚠️ ไม่ใช่ระดับสิทธิ์ — agent ได้สิทธิ์จาก workspace_members เหมือนคนทุกอย่าง
 *    คอลัมน์นี้บอกแค่ "ใครเป็นคนทำ" เพื่อให้ตอบได้ว่าหน้านี้ AI แก้หรือเจ้าของแก้
 */
export const USER_KINDS = ['human', 'agent'] as const;
export type UserKind = (typeof USER_KINDS)[number];

export const PAGE_STATUSES = ['todo', 'doing', 'done'] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

// ═══════════════════════════════════════════════════════════════════════════
//  กฎของสิทธิ์
// ═══════════════════════════════════════════════════════════════════════════

/**
 * owner/admin ของ workspace มีสิทธิ์ full ทุกหน้าโดยไม่ต้องดู page_acl
 * (short-circuit นี้ทำให้ permission query ไม่ต้องรันเลยในกรณีที่พบบ่อยที่สุด)
 */
export const isWorkspaceWideEditor = (role: WorkspaceRole): boolean =>
  role === 'owner' || role === 'admin';

/** สิทธิ์ที่แก้เนื้อหาได้ */
export const canEdit = (role: PageRole): boolean => role === 'editor' || role === 'full';

/**
 * สิทธิ์ที่เขียนบันทึก/ความคิดเห็นบนหน้าได้ แต่ไม่จำเป็นต้องแก้เนื้อหาหน้าได้
 *
 * ⚠️ นี่คือที่เดียวที่แยก commenter ออกจาก viewer — ก่อนมีบันทึก ทุกทางเขียน
 *    เช็ค canEdit() ซึ่ง commenter ไม่ผ่าน ผลคือ commenter ทำอะไรได้เท่ากับ
 *    viewer เป๊ะ ๆ และ tier นั้นไม่มีความหมายเลย
 */
export const canComment = (role: PageRole): boolean =>
  role === 'commenter' || role === 'editor' || role === 'full';
