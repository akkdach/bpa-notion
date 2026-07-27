import { Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { statusLabel, type PageStatus } from '@/features/pages'
import { describeActivity, formatRelative, undoableStatus } from '../describe'
import type { Activity } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  ActivityFeed — presentational
//
//  หน้าจอที่ตอบคำถาม "AI ทำอะไรไปบ้าง" ซึ่งเป็นเหตุผลของงานทั้งชุดนี้
//
//  ก่อนหน้านี้ตอบไม่ได้เลยด้วยสามเหตุผลพร้อมกัน: ไม่มีตารางประวัติ, MCP ใช้บัญชี
//  เดียวกับเจ้าของ (แยกไม่ออกว่าใครแก้) และ pages.status ที่ AI เขียนมองไม่เห็น
//  บนเว็บ
// ═══════════════════════════════════════════════════════════════════════════

interface ActivityFeedProps {
  items: Activity[]
  truncated?: boolean
  /** ไม่ส่ง = ไม่มีปุ่มย้อนกลับ (เช่นตอนดูประวัติของหน้าเดียวในแผงข้าง) */
  onUndoStatus?: (pageId: string, previous: PageStatus | '') => void
  onSelectPage?: (pageId: string) => void
  busyPageId?: string | undefined
}

export function ActivityFeed({
  items,
  truncated,
  onUndoStatus,
  onSelectPage,
  busyPageId,
}: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        ยังไม่มีกิจกรรม
      </p>
    )
  }

  return (
    <>
      <ul className="divide-y rounded-lg border">
        {items.map((item) => {
          const byAgent = item.actorKind === 'agent'
          const undoTo = undoableStatus(item)

          return (
            <li key={item.id} className="flex items-start gap-3 px-4 py-3">
              <span
                aria-hidden
                className="mt-0.5 shrink-0 text-base leading-none"
                title={byAgent ? 'ทำโดย AI' : 'ทำโดยคน'}
              >
                {byAgent ? '🤖' : '👤'}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className={cn('font-medium', byAgent && 'text-warning')}>
                    {item.actorName ?? 'ไม่ทราบผู้ทำ'}
                  </span>
                  {' '}
                  {describeActivity(item)}
                </p>

                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{formatRelative(item.createdAt)}</span>

                  {/* หน้าที่ถูกลบถาวรแล้วยังอยู่ในประวัติ แต่กดเข้าไปไม่ได้ —
                      บอกให้ชัดแทนที่จะให้ปุ่มที่กดแล้วไม่เกิดอะไร */}
                  {item.pageId === undefined ? (
                    <span className="italic">· หน้านี้ถูกลบถาวรแล้ว</span>
                  ) : onSelectPage !== undefined ? (
                    <>
                      <span aria-hidden>·</span>
                      <button
                        type="button"
                        onClick={() => onSelectPage(item.pageId!)}
                        className="truncate underline-offset-2 hover:underline"
                      >
                        {item.pageTitle.length > 0 ? item.pageTitle : 'ไม่มีชื่อ'}
                      </button>
                    </>
                  ) : null}
                </p>

                {item.detail?.preview !== undefined && (
                  <p className="mt-1 rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                    {item.detail.preview}
                  </p>
                )}
              </div>

              {/* ปุ่มย้อนกลับโผล่เฉพาะเหตุการณ์ที่ย้อนได้จริง — ดูคอมเมนต์ใน useActivity */}
              {undoTo !== null && onUndoStatus !== undefined && item.pageId !== undefined && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={busyPageId === item.pageId}
                  onClick={() => onUndoStatus(item.pageId!, undoTo)}
                  title={`เปลี่ยนกลับเป็น ${undoTo === '' ? 'ไม่ใช่งาน' : statusLabel(undoTo)}`}
                >
                  <Undo2 className="size-3.5" aria-hidden />
                  ย้อนกลับ
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {truncated === true && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          แสดงเฉพาะรายการล่าสุด — ยังมีมากกว่านี้
        </p>
      )}
    </>
  )
}
