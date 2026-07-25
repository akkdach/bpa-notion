// ═══════════════════════════════════════════════════════════════════════════
//  barrel — public surface เดียวของ feature นี้
//  ข้างนอกต้อง import จากที่นี่ ห้ามเจาะเข้า service/ หรือ hooks/ ตรง ๆ
// ═══════════════════════════════════════════════════════════════════════════
export { AuthProvider } from './AuthProvider'
export { useAuth } from './hooks/useAuth'
export { AuthForm } from './components/AuthForm'
export type { User, AuthSession } from './types'
