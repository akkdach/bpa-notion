// ═══════════════════════════════════════════════════════════════════════════
//  barrel — public surface เดียวของ feature นี้
//  ข้างนอกต้อง import จากที่นี่ ห้ามเจาะเข้า service/ หรือ hooks/ ตรง ๆ
//  (บังคับด้วย eslint-plugin-boundaries)
// ═══════════════════════════════════════════════════════════════════════════
export { HealthPanel } from './components/HealthPanel'
export { useHealth, healthKeys } from './hooks/useHealth'
export type { HealthStatus } from './types'
