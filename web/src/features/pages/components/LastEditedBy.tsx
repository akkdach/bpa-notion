import { cn } from '@/lib/utils'
import { formatRelative } from '@/lib/relativeTime'
import type { EditorIdentity } from '../hooks/useEditorName'

// ═══════════════════════════════════════════════════════════════════════════
//  LastEditedBy — "แก้ล่าสุดโดยใคร เมื่อไหร่" · presentational ล้วน
//
//  ⚠️ ถ้ายังไม่รู้ว่าใคร ให้แสดงแค่เวลา ห้ามเขียนว่า "ไม่ทราบ" หรือเดาเป็นชื่อคน
//     ที่ล็อกอินอยู่ — หน้าที่ AI แก้แล้วขึ้นชื่อคุณคือข้อมูลที่ผิดและตรวจสอบ
//     ย้อนหลังไม่ได้ ซึ่งแย่กว่าการไม่บอกอะไรเลย
// ═══════════════════════════════════════════════════════════════════════════

interface LastEditedByProps {
  editor: EditorIdentity | null
  updatedAt: string
  className?: string
}

export function LastEditedBy({ editor, updatedAt, className }: LastEditedByProps) {
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      {editor === null ? (
        <>แก้ล่าสุด {formatRelative(updatedAt)}</>
      ) : (
        <>
          แก้ล่าสุดโดย{' '}
          <span className={cn('font-medium', editor.isAgent ? 'text-warning' : 'text-foreground')}>
            {editor.isAgent && '🤖 '}
            {editor.isMe ? 'คุณ' : editor.name}
          </span>{' '}
          · {formatRelative(updatedAt)}
        </>
      )}
    </p>
  )
}
