import { statusLabel, type PageStatus } from '@/features/pages'
import type { Activity } from './types'

// ═══════════════════════════════════════════════════════════════════════════
//  แปลงแถวประวัติเป็นประโยคภาษาไทย
//
//  แยกออกจาก component เพราะเป็น logic ล้วน ๆ ที่ควรอ่านและแก้ได้โดยไม่ต้องอ่าน JSX
//  (และเพราะไฟล์ที่ export ทั้ง component และฟังก์ชันทำให้ Fast Refresh ใช้ไม่ได้)
// ═══════════════════════════════════════════════════════════════════════════

/** ค่าที่ฝั่ง API ใช้แทน "ไม่มีสถานะ" ใน detail — ดู ActivityEntry.StatusOrNone */
const NO_STATUS = 'none'

function statusText(value: string | null | undefined): string {
  if (value === undefined || value === null || value === NO_STATUS) return 'ไม่ใช่งาน'
  return statusLabel(value as PageStatus)
}

/**
 * ประโยคที่ต่อท้ายชื่อผู้ทำ เช่น "เปลี่ยนสถานะจาก กำลังทำ เป็น เสร็จแล้ว"
 *
 * ⚠️ ต้องมี default ที่อ่านรู้เรื่องเสมอ — activity_log เป็นข้อมูลที่อยู่ยาว และ
 *    เซิร์ฟเวอร์รุ่นใหม่กว่าเว็บที่เปิดค้างไว้จะส่ง action ที่เว็บยังไม่รู้จักมาได้
 *    ถ้าไม่มี default หน้าจะขึ้นว่างเปล่าโดยไม่บอกอะไร ซึ่งแย่กว่าข้อความดิบ
 */
export function describeActivity(item: Activity): string {
  const detail = item.detail

  switch (item.action) {
    case 'page_created':
      return detail?.parentId == null ? 'สร้างโปรเจกต์นี้' : 'สร้างงานนี้'

    case 'page_renamed':
      return `เปลี่ยนชื่อจาก “${detail?.from ?? '—'}” เป็น “${detail?.to ?? '—'}”`

    case 'status_changed':
      return `เปลี่ยนสถานะจาก ${statusText(detail?.from)} เป็น ${statusText(detail?.to)}`

    case 'icon_changed':
      return 'เปลี่ยนไอคอน'

    case 'page_moved':
      return detail?.toParentId == null
        ? 'ย้ายขึ้นเป็นโปรเจกต์ระดับบนสุด'
        : 'ย้ายไปอยู่ใต้หน้าอื่น'

    case 'page_deleted':
      return 'ย้ายไปถังขยะ'

    case 'page_restored':
      return 'กู้คืนจากถังขยะ'

    case 'note_added':
      return 'เขียนบันทึกความคืบหน้า'

    default:
      // ยังอ่านรู้เรื่องแม้ไม่รู้จัก action — ดีกว่าแถวว่าง
      return `ทำรายการ “${item.action}”`
  }
}

/**
 * สถานะที่จะย้อนกลับไป — null = เหตุการณ์นี้ย้อนไม่ได้
 *
 * รองรับแค่ status_changed เพราะเป็นเหตุการณ์เดียวที่ประวัติเก็บข้อมูลครบพอจะ
 * ย้อนได้จริง (ดูเหตุผลของอันอื่นใน hooks/useActivity.ts)
 */
export function undoableStatus(item: Activity): PageStatus | '' | null {
  if (item.action !== 'status_changed') return null

  const from = item.detail?.from
  if (from === undefined || from === null) return null
  if (from === NO_STATUS) return ''

  return from === 'todo' || from === 'doing' || from === 'done' ? from : null
}

// เวลาแบบ "5 นาทีที่แล้ว" อยู่ใน lib เพราะ features/pages ใช้ตัวเดียวกัน
export { formatRelative } from '@/lib/relativeTime'
