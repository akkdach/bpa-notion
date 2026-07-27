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

export interface WorkspaceDetail {
  id: string
  slug: string
  name: string
  icon?: string
  myRole: WorkspaceRole
  memberCount: number
  createdAt: string
}

export interface UpdateWorkspaceInput {
  name: string
  icon?: string
}

/**
 * คนหรือ AI — ตรงกับ users.kind ฝั่ง API
 *
 * ไม่ใช่ระดับสิทธิ์: agent ได้สิทธิ์จาก role เหมือนคนทุกอย่าง ค่านี้บอกแค่ว่า
 * "ใครเป็นคนทำ" เพื่อให้เจ้าของแยกงานที่ AI แก้ออกจากงานที่ตัวเองแก้ได้
 */
export type UserKind = 'human' | 'agent'

export interface Member {
  userId: string
  email: string
  name: string
  avatarUrl?: string
  role: WorkspaceRole
  kind: UserKind
  joinedAt: string
}

/**
 * เพิ่มสมาชิกด้วยอีเมลของคนที่ "สมัครไว้แล้ว"
 *
 * ไม่มีการเชิญทางอีเมลโดยเจตนา (ไม่มี SMTP ในระบบ) — ผู้ใช้ต้องสมัครเองก่อน
 * แล้ว admin ค่อยพิมพ์อีเมลเพิ่มเข้ามา
 */
export interface AddMemberInput {
  email: string
  role: WorkspaceRole
}

/** role ที่มอบให้คนอื่นได้ — owner โอนด้วยวิธีนี้ไม่ได้ */
export const ASSIGNABLE_ROLES = ['admin', 'member', 'guest'] as const

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'เจ้าของ',
  admin: 'ผู้ดูแล',
  member: 'สมาชิก',
  guest: 'ผู้เยี่ยมชม',
}
