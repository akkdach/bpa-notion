// ═══════════════════════════════════════════════════════════════════════════
//  ที่เก็บ token — อยู่ใน lib เพราะทั้ง apiClient (interceptor) และ
//  features/auth ต้องใช้ ถ้าอยู่ใน feature จะเกิด dependency ย้อนทิศ
//
//  ⚠️ เก็บใน localStorage ซึ่งอ่านได้ด้วย JavaScript ทุกตัวบนหน้านั้น
//     แปลว่าถ้ามีช่อง XSS token จะหลุด
//
//     ทางที่ปลอดภัยกว่าคือ refresh token เป็น httpOnly cookie แล้วเก็บ access
//     token ไว้ในหน่วยความจำอย่างเดียว — ซึ่งเป็นงาน Phase 9 (ต้องแก้ทั้ง
//     CSRF protection และ flow ตอน refresh) จดไว้ตรงนี้เพื่อไม่ให้ลืมว่า
//     นี่คือหนี้ที่รู้ตัว ไม่ใช่การตัดสินใจว่าปลอดภัยแล้ว
// ═══════════════════════════════════════════════════════════════════════════

const ACCESS_KEY = 'pm.accessToken'
const REFRESH_KEY = 'pm.refreshToken'
const WORKSPACE_KEY = 'pm.workspaceId'

/** access token เก็บในหน่วยความจำด้วย เพื่อไม่ต้องอ่าน localStorage ทุก request */
let cachedAccessToken: string | null = null

export const tokenStore = {
  getAccessToken(): string | null {
    cachedAccessToken ??= localStorage.getItem(ACCESS_KEY)
    return cachedAccessToken
  },

  getRefreshToken: () => localStorage.getItem(REFRESH_KEY),

  save(accessToken: string, refreshToken: string) {
    cachedAccessToken = accessToken
    localStorage.setItem(ACCESS_KEY, accessToken)
    localStorage.setItem(REFRESH_KEY, refreshToken)
  },

  clear() {
    cachedAccessToken = null
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },

  // ─── workspace ที่เลือกอยู่ ─────────────────────────────────────────────
  // ต้องอยู่ที่นี่เพราะ apiClient ใส่ header X-Workspace-Id ให้ทุก request
  // (ดู ITenantContext ฝั่ง API — workspace มาจาก header ไม่ใช่จาก token)
  getWorkspaceId: () => localStorage.getItem(WORKSPACE_KEY),

  setWorkspaceId(workspaceId: string | null) {
    if (workspaceId === null) localStorage.removeItem(WORKSPACE_KEY)
    else localStorage.setItem(WORKSPACE_KEY, workspaceId)
  },
}
