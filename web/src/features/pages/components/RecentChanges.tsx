import { cn } from '@/lib/utils'
import { formatRelative } from '@/lib/relativeTime'
import { StatusChip } from './StatusChip'
import { useEditorName } from '../hooks/useEditorName'
import type { PageNode } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  RecentChanges — presentational
//
//  ชื่อว่า "เปลี่ยนแปลงล่าสุด" ไม่ใช่ "ฟีดกิจกรรม" โดยเจตนา
//
//  มันคือ tree ที่มีอยู่แล้วเรียงตาม updated_at ไม่ใช่ log ของเหตุการณ์ จึงบอกได้
//  แค่ว่า "หน้านี้ถูกแก้ล่าสุดเมื่อไหร่" บอกไม่ได้ว่าแก้อะไร แก้กี่ครั้ง หรือใครลบ
//  อะไรไป การตั้งชื่อให้ตรงกับสิ่งที่มันเป็นทำให้ไม่ต้องรื้อทิ้งตอนมี activity_log
//  จริง — ตอนนั้นค่อยเพิ่มหน้าฟีดแยก แล้วอันนี้ยังมีประโยชน์ต่อไปได้
// ═══════════════════════════════════════════════════════════════════════════

interface RecentChangesProps {
  nodes: PageNode[]
  limit?: number
  /**
   * ตัวตนของคนที่ล็อกอินอยู่ — ยังรับไว้เพื่อไม่ให้ผู้เรียกเดิมพัง
   * แต่การแยก "ฉัน / คนอื่น / AI" ย้ายไปอยู่ใน useEditorName แล้ว
   */
  currentUserId?: string | undefined
  onSelect: (pageId: string) => void
}

export function RecentChanges({
  nodes,
  limit = 20,
  onSelect,
}: RecentChangesProps) {
  const editorName = useEditorName()

  const recent = [...nodes]
    .filter((node) => node.deletedAt === undefined)
    // เรียงด้วย string ได้เพราะเป็น ISO-8601 UTC — เทียบตัวอักษรแล้วได้ลำดับเวลา
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)

  if (recent.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        ยังไม่มีความเปลี่ยนแปลง
      </p>
    )
  }

  return (
    <ul className="divide-y rounded-lg border">
      {recent.map((node) => {
        const editor = editorName(node.lastEditedBy)
        const byOther = editor !== null && !editor.isMe

        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50"
            >
              <span aria-hidden className="shrink-0">{node.icon ?? '📄'}</span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {node.title.length > 0 ? node.title : 'ไม่มีชื่อ'}
                </span>
                {/* บอกชื่อคนแก้ ไม่ใช่แค่ "คนอื่น" — ไม่งั้นต้องไปเปิดฟีดกิจกรรม
                    ทุกครั้งเพื่อตอบคำถามว่าใครแตะหน้านี้ */}
                <span className={cn('text-xs', byOther ? 'text-warning' : 'text-muted-foreground')}>
                  {formatRelative(node.updatedAt)}
                  {editor !== null && (
                    <>
                      {' · '}
                      {editor.isMe ? 'คุณแก้' : `${editor.isAgent ? '🤖 ' : ''}${editor.name}`}
                    </>
                  )}
                </span>
              </span>

              <StatusChip status={node.status} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

