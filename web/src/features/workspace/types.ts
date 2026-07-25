// ═══════════════════════════════════════════════════════════════════════════
//  ชนิดข้อมูลของ workspace อยู่ที่นี่ ไม่ใช่ใน features/auth
//
//  ⚠️ ตอนแรกเขียนไว้ใน auth/types.ts แล้วให้ workspace/service import มา
//     eslint-plugin-boundaries ฟ้องว่า feature-service ห้าม import feature-root
//     ของ feature อื่น ซึ่งถูกแล้ว
//
//     ที่ถูกคือให้ feature ที่เป็น "เจ้าของ" ชนิดข้อมูลเป็นคนประกาศ แล้ว feature
//     อื่นค่อย import ผ่าน barrel — auth คืนรายการ workspace มากับ login ก็จริง
//     แต่ไม่ได้แปลว่า auth เป็นเจ้าของนิยาม
// ═══════════════════════════════════════════════════════════════════════════

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest'

export interface WorkspaceSummary {
  id: string
  slug: string
  name: string
  icon?: string
  role: WorkspaceRole
}

export interface CreateWorkspaceInput {
  name: string
  slug?: string
  icon?: string
}
