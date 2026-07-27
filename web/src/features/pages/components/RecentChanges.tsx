import { cn } from '@/lib/utils'
import { formatRelative } from '@/lib/relativeTime'
import { StatusChip } from './StatusChip'
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
  /** ตัวตนของคนที่ล็อกอินอยู่ — ใช้แยก "ฉันแก้" ออกจาก "คนอื่น/AI แก้" */
  currentUserId?: string | undefined
  onSelect: (pageId: string) => void
}

export function RecentChanges({
  nodes,
  limit = 20,
  currentUserId,
  onSelect,
}: RecentChangesProps) {
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
        const byOther = node.lastEditedBy !== undefined && node.lastEditedBy !== currentUserId

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
                <span className={cn('text-xs', byOther ? 'text-warning' : 'text-muted-foreground')}>
                  {formatRelative(node.updatedAt)}
                  {byOther && ' · แก้โดยคนอื่น'}
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

