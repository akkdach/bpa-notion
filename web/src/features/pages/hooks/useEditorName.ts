import { useCallback } from 'react'
import { useAuth } from '@/features/auth'
import { useMembers } from '@/features/workspace'

// ═══════════════════════════════════════════════════════════════════════════
//  แปลง lastEditedBy (เป็น id) ให้เป็นชื่อคน
//
//  ⚠️ API ส่ง id ไม่ใช่ชื่อ โดยเจตนา — PageNodeDto ใช้โหลด tree ทั้ง workspace
//     ทีเดียว การ join users ต่อทุกโหนดไม่คุ้ม (ดูคอมเมนต์ใน pages.schema.ts)
//     การ resolve จึงเป็นหน้าที่ฝั่งเว็บ ซึ่งมีรายชื่อสมาชิกอยู่แล้วและ cache
//     ไว้ด้วย react-query — จ่ายแค่ครั้งเดียวต่อ workspace
//
//  คืน null เมื่อยังโหลดรายชื่อไม่เสร็จ หรือคนแก้ไม่ได้อยู่ใน workspace แล้ว
//  (ถูกถอดออกทีหลัง) — ผู้เรียกต้องเผื่อกรณีนี้ ห้ามเดาชื่อขึ้นมาเอง
// ═══════════════════════════════════════════════════════════════════════════

export interface EditorIdentity {
  name: string
  /** true = บัญชีของ AI — ใช้ตัดสินใจว่าจะติดป้าย 🤖 ไหม */
  isAgent: boolean
  /** true = คนที่ล็อกอินอยู่ตอนนี้ */
  isMe: boolean
}

export function useEditorName(): (userId: string | null | undefined) => EditorIdentity | null {
  const members = useMembers()
  const { user } = useAuth()
  const list = members.data

  return useCallback(
    (userId) => {
      if (userId === null || userId === undefined || list === undefined) return null

      const member = list.find((m) => m.userId === userId)
      if (member === undefined) return null

      return {
        name: member.name.length > 0 ? member.name : member.email,
        isAgent: member.kind === 'agent',
        isMe: userId === user?.id,
      }
    },
    [list, user?.id],
  )
}
