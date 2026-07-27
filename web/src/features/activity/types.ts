import type { PageStatus } from '@/features/pages'
import type { UserKind } from '@/features/workspace'

// ═══════════════════════════════════════════════════════════════════════════
//  ฟีดกิจกรรม — ตรงกับ ActivityDto ฝั่ง API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ชนิดของเหตุการณ์
 *
 * ⚠️ ต้องเผื่อค่าที่ยังไม่รู้จักเสมอ (`(string & {})`) — activity_log เป็นข้อมูล
 *    ประวัติศาสตร์ที่อยู่ยาว เซิร์ฟเวอร์รุ่นใหม่กว่าเว็บที่ผู้ใช้เปิดค้างไว้จะส่ง
 *    action ที่เว็บยังไม่รู้จักมาได้ ถ้า type บังคับให้เป็น union ปิด จะเขียนโค้ด
 *    ที่ลืมเคสนั้นแล้วหน้าเจ๊งทั้งฟีดเพราะเหตุการณ์เดียว
 */
export type ActivityAction =
  | 'page_created'
  | 'page_renamed'
  | 'status_changed'
  | 'icon_changed'
  | 'page_moved'
  | 'page_deleted'
  | 'page_restored'
  | 'note_added'
  | (string & {})

/**
 * รายละเอียดของเหตุการณ์
 *
 * `v` คือเวอร์ชันของ schema — มีมาตั้งแต่แถวแรกเพื่อให้เพิ่ม field ทีหลังแล้ว
 * ยังอ่านแถวเก่าได้ ทุก field เป็น optional เพราะแต่ละ action ใช้คนละชุด
 */
export interface ActivityDetail {
  v?: number
  from?: string | null
  to?: string | null
  fromParentId?: string | null
  toParentId?: string | null
  status?: string
  parentId?: string | null
  preview?: string
}

export interface Activity {
  id: number
  /** ไม่มีค่า = หน้าถูกลบถาวรไปแล้ว — ใช้ pageTitle ที่เก็บสำเนาไว้แทน */
  pageId?: string
  pageTitle: string
  actorUserId?: string
  actorName?: string
  actorKind?: UserKind
  action: ActivityAction
  detail?: ActivityDetail
  createdAt: string
}

export interface ActivityFeed {
  count: number
  truncated: boolean
  items: Activity[]
}

export interface ActivityQuery {
  pageId?: string
  actorKind?: UserKind
  limit?: number
}

// ═══════════════════════════════════════════════════════════════════════════
//  บันทึกบนหน้า
// ═══════════════════════════════════════════════════════════════════════════

export interface Note {
  id: string
  pageId: string
  authorUserId?: string
  authorName?: string
  authorKind?: UserKind
  body: string
  createdAt: string
}

/** สถานะที่ย้อนกลับได้จากฟีด — ดู useUndoStatus */
export type UndoableStatus = PageStatus | ''
