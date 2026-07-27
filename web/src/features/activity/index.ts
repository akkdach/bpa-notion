// ═══════════════════════════════════════════════════════════════════════════
//  barrel — public surface เดียวของ feature นี้
//  ข้างนอกต้อง import จากที่นี่ ห้ามเจาะเข้า service/ หรือ hooks/ ตรง ๆ
//  (บังคับด้วย eslint-plugin-boundaries)
// ═══════════════════════════════════════════════════════════════════════════
export { ActivityFeed } from './components/ActivityFeed'
export { NotePanel } from './components/NotePanel'

export { useActivity, useNotes, useAddNote, activityKeys } from './hooks/useActivity'

export { describeActivity, undoableStatus } from './describe'

export type {
  Activity, ActivityAction, ActivityDetail, ActivityFeed as ActivityFeedData,
  ActivityQuery, Note,
} from './types'
