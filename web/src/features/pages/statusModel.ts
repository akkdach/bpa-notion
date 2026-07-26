import { PAGE_STATUSES, type PageStatus } from './types'

// ═══════════════════════════════════════════════════════════════════════════
//  ตัวแบบของสถานะงาน — ข้อความ สัญลักษณ์ สี และการวน
//
//  แยกออกจาก StatusChip.tsx เพราะไฟล์ที่ export ทั้ง component และฟังก์ชัน
//  ธรรมดาทำให้ Fast Refresh ของ Vite ใช้ไม่ได้ (react-refresh/only-export-components)
//  และเพราะบอร์ดใน S5 ต้องใช้ค่าพวกนี้โดยไม่ต้อง import ตัว chip
// ═══════════════════════════════════════════════════════════════════════════

const LABEL: Record<PageStatus, string> = {
  todo: 'ยังไม่เริ่ม',
  doing: 'กำลังทำ',
  done: 'เสร็จแล้ว',
}

const GLYPH: Record<PageStatus, string> = {
  todo: '⬜',
  doing: '🔄',
  done: '✅',
}

const TONE: Record<PageStatus, string> = {
  todo: 'text-muted-foreground',
  doing: 'text-warning',
  done: 'text-success',
}

/** ข้อความสำหรับหน้าที่ยังไม่ใช่งาน — ใช้เป็นคำเชิญให้กด */
export const UNSET_LABEL = 'ทำเป็นงาน'
export const UNSET_GLYPH = '▫️'
export const UNSET_TONE = 'text-muted-foreground/50'

export function statusLabel(status: PageStatus | undefined): string {
  return status === undefined ? UNSET_LABEL : LABEL[status]
}

export function statusGlyph(status: PageStatus | undefined): string {
  return status === undefined ? UNSET_GLYPH : GLYPH[status]
}

export function statusTone(status: PageStatus | undefined): string {
  return status === undefined ? UNSET_TONE : TONE[status]
}

/**
 * สถานะถัดไปในวง: (ไม่ใช่งาน) → todo → doing → done → (ไม่ใช่งาน)
 *
 * การวนกลับไปเป็น "ไม่ใช่งาน" สำคัญ — ไม่งั้นเผลอกดหน้าธรรมดาทีเดียวแล้วมันจะ
 * กลายเป็นงานตลอดกาลโดยไม่มีทางเอาออกจากหน้านั้น
 *
 * '' (สตริงว่าง) คือค่าที่ API ใช้แทน "ล้างสถานะ" — ต่างจาก undefined ที่แปลว่า
 * "ไม่แตะ" (ดู UpdatePageRequest ฝั่ง API)
 */
export function nextStatus(current: PageStatus | undefined): PageStatus | '' {
  if (current === undefined) return PAGE_STATUSES[0]!

  const index = PAGE_STATUSES.indexOf(current)
  return PAGE_STATUSES[index + 1] ?? ''
}
