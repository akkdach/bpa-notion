// ═══════════════════════════════════════════════════════════════════════════
//  ชนิดของเหตุการณ์ใน activity_logs
//
//  เป็น string ธรรมดา ไม่ใช่ union ที่แคบ เพราะ log เป็นข้อมูล "ประวัติศาสตร์"
//  — แถวที่เขียนไปแล้วต้องอ่านได้ตลอดไป แม้โค้ดรุ่นใหม่จะเลิกผลิต action ชนิด
//  นั้นแล้ว
//
//  ⚠️ ไม่มี CHECK constraint บนคอลัมน์นี้โดยเจตนา ต่างจาก enum อื่นทั้งระบบ
//     ด้วยเหตุผลเดียวกัน — constraint จะทำให้ลบ action เก่าออกจากโค้ดไม่ได้เลย
//     (ดู sql/objects.sql ส่วน CHECK constraints)
// ═══════════════════════════════════════════════════════════════════════════
export const ActivityAction = {
  PageCreated: 'page_created',
  PageRenamed: 'page_renamed',
  StatusChanged: 'status_changed',
  IconChanged: 'icon_changed',
  PageMoved: 'page_moved',
  PageDeleted: 'page_deleted',
  PageRestored: 'page_restored',
  NoteAdded: 'note_added',
} as const;

/** ค่าที่ใช้แทน "ไม่มีสถานะ" ใน detail — null ใน JSON อ่านกำกวมกว่า */
export const STATUS_NONE = 'none';

export const statusOrNone = (status: string | null): string => status ?? STATUS_NONE;

/**
 * เวอร์ชันของ schema ใน detail
 *
 * ⚠️ มีตั้งแต่แถวแรก — log อยู่ยาว การเพิ่ม field ทีหลังแล้วยังอ่านแถวเก่าได้
 *    ต้องมีตัวบอกรุ่น ไม่ใช่เดาจากการมี/ไม่มีคีย์
 */
const SCHEMA_VERSION = 1;

export interface ActivityRow {
  workspaceId: string;
  pageId: string | null;
  pageTitle: string;
  actorUserId: string;
  action: string;
  detail: Record<string, unknown>;
}

/**
 * ประกอบแถวประวัติ — คืนค่าที่ยังไม่ถูกเขียน ผู้เรียกส่งต่อให้ repository เขียน
 * ในธุรกรรมเดียวกับการเปลี่ยนแปลง
 *
 * ⚠️ เก็บค่าเดิม (from) ไว้ด้วยเสมอ ไม่ใช่แค่ค่าใหม่ — ปุ่มย้อนกลับต้องใช้ และ
 *    ประวัติที่บอกแต่ผลลัพธ์ตอบไม่ได้ว่าเปลี่ยนมาจากอะไร
 */
export function buildActivity(input: {
  workspaceId: string;
  pageId: string;
  pageTitle: string;
  actorUserId: string;
  action: string;
  detail?: Record<string, unknown>;
}): ActivityRow {
  return {
    workspaceId: input.workspaceId,
    pageId: input.pageId,
    // ตัดตามความยาวคอลัมน์ — ชื่อหน้ายาวเกินไม่ควรทำให้การบันทึกประวัติล้มทั้งแถว
    // เพราะประวัติเป็นผลข้างเคียงของสิ่งที่ผู้ใช้ตั้งใจทำ
    pageTitle: input.pageTitle.slice(0, 400),
    actorUserId: input.actorUserId,
    action: input.action,
    detail: { v: SCHEMA_VERSION, ...input.detail },
  };
}
