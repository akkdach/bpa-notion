// ═══════════════════════════════════════════════════════════════════════════
//  barrel — public surface เดียวของ feature นี้
//  ข้างนอกต้อง import จากที่นี่ ห้ามเจาะเข้า components/ หรือ hooks/ ตรง ๆ
//  (บังคับด้วย eslint-plugin-boundaries)
// ═══════════════════════════════════════════════════════════════════════════
export { SettingsLayout } from './components/SettingsLayout'
export type { SettingsSection } from './components/SettingsLayout'
export { AppearanceSettings } from './components/AppearanceSettings'
export { useApplyTheme, useResolvedTheme } from './hooks/useTheme'
export type { ResolvedTheme } from './hooks/useTheme'
