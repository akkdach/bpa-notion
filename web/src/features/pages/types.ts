/**
 * สถานะงาน — ตรงกับ PageStatus.All ฝั่ง API และ ck_pages_status ในฐานข้อมูล
 *
 * undefined = หน้านี้ไม่ใช่ "งาน" ซึ่งเป็นค่าปกติของหน้าส่วนใหญ่
 */
export type PageStatus = 'todo' | 'doing' | 'done'

/** ลำดับที่ใช้วนเวลากดที่ chip และลำดับคอลัมน์บนบอร์ด */
export const PAGE_STATUSES: readonly PageStatus[] = ['todo', 'doing', 'done']

/** โหนดใน sidebar — ตรงกับ PageNodeDto ฝั่ง API */
export interface PageNode {
  id: string
  parentId: string | null
  title: string
  /** ⚠️ API ส่ง null เมื่อไม่มีไอคอน ไม่ใช่ตัดฟิลด์ทิ้ง — ชนิดต้องบอกความจริง
   *     ไม่งั้นโค้ดที่เช็คแค่ `!== undefined` จะพลาด null เงียบ ๆ */
  icon?: string | null
  status?: PageStatus
  rank: string
  depth: number
  hasChildren: boolean
  /** id ของคนที่แก้ล่าสุด — ชื่อคนต้อง resolve แยก (ดูคอมเมนต์ใน PageDto ฝั่ง API) */
  lastEditedBy?: string
  updatedAt: string
  deletedAt?: string
}

/** ตรงกับ PageDto ฝั่ง API */
export interface Page {
  id: string
  parentId: string | null
  ancestorIds: string[]
  depth: number
  rank: string
  kind: 'page' | 'database' | 'db_row'
  title: string
  /** null เมื่อไม่มีไอคอน (ดูหมายเหตุใน PageNode) */
  icon?: string | null
  coverUrl?: string | null
  status?: PageStatus
  accessRootId: string
  myRole: 'viewer' | 'commenter' | 'editor' | 'full'
  lastEditedBy?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface CreatePageInput {
  parentId: string | null
  title?: string
  afterPageId?: string
  status?: PageStatus
}

/**
 * ส่งเฉพาะช่องที่ต้องการเปลี่ยน — ช่องที่ไม่ส่งเซิร์ฟเวอร์จะไม่แตะ
 *
 * ⚠️ status: '' (สตริงว่าง) = ล้างสถานะให้กลับเป็นหน้าปกติ ต่างจาก undefined
 *    ที่แปลว่า "ไม่แตะ" ความต่างนี้เป็นสัญญาของ API (ดู UpdatePageRequest)
 */
export interface UpdatePageInput {
  title?: string
  /** null = เอาไอคอนออก · undefined = ไม่แตะ (ตรงกับ updatePageSchema ฝั่ง API) */
  icon?: string | null
  coverUrl?: string
  status?: PageStatus | ''
}
