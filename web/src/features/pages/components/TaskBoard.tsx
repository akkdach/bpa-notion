import { cn } from '@/lib/utils'
import { statusGlyph, statusLabel } from '../statusModel'
import { PAGE_STATUSES, type PageNode, type PageStatus } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  TaskBoard — presentational
//
//  บอร์ดง่าย ๆ จัดกลุ่มตาม pages.status ให้เจ้าของเห็นภาพรวมงานในหน้าเดียว
//
//  ⚠️ นี่คือของชั่วคราวโดยรู้ตัว — PLAN.md Phase 4a มี BoardView/BoardColumn/
//     BoardCard ที่ทำงานบน database view จริง (typed properties, filter/sort/group
//     ที่ผู้ใช้กำหนดเอง) ตัวนี้จึงตั้งชื่อ TaskBoard และอยู่ใน features/pages
//     ไม่ใช่ features/board เพื่อไม่ไปจอง path ที่ Phase 4a จะใช้
//
//  ⚠️ ยังไม่มีลากวาง — เปลี่ยนสถานะด้วยการกดที่ chip ซึ่งวนไปสถานะถัดไป
//     @dnd-kit ลงไว้แล้วแต่ยังไม่ได้ใช้ การทำลากวางให้ถูกต้อง (คีย์บอร์ด,
//     screen reader, touch) ใหญ่กว่าที่ควรใส่มาในระยะนี้ และการกดวนก็ทำงานได้
//     กับทุก input อยู่แล้ว
// ═══════════════════════════════════════════════════════════════════════════

interface TaskBoardProps {
  nodes: PageNode[]
  busyPageId?: string | undefined
  onSelect: (pageId: string) => void
  onSetStatus: (pageId: string, status: PageStatus) => void
}

export function TaskBoard({ nodes, busyPageId, onSelect, onSetStatus }: TaskBoardProps) {
  const tasks = nodes.filter((node) => node.deletedAt === undefined && node.status !== undefined)

  if (tasks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        ยังไม่มีงาน — กดที่ช่องสี่เหลี่ยมข้างชื่อหน้าในแถบด้านซ้ายเพื่อทำหน้านั้นเป็นงาน
      </p>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {PAGE_STATUSES.map((status) => {
        const column = tasks.filter((task) => task.status === status)

        return (
          <section key={status} aria-label={statusLabel(status)} className="min-w-0">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <span aria-hidden>{statusGlyph(status)}</span>
              {statusLabel(status)}
              <span className="text-xs text-muted-foreground">{column.length}</span>
            </h2>

            <ul className="space-y-2">
              {column.map((task) => (
                <li key={task.id}>
                  <div
                    className={cn(
                      'rounded-lg border bg-card p-3',
                      busyPageId === task.id && 'opacity-50',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(task.id)}
                      className="block w-full text-left"
                    >
                      <span className="flex items-start gap-2">
                        <span aria-hidden className="shrink-0">{task.icon ?? '📄'}</span>
                        <span
                          className={cn(
                            'min-w-0 flex-1 break-words text-sm',
                            status === 'done' && 'text-muted-foreground line-through',
                          )}
                        >
                          {task.title.length > 0 ? task.title : 'ไม่มีชื่อ'}
                        </span>
                      </span>
                    </button>

                    {/* ปุ่มย้ายคอลัมน์ — แทนการลากวาง ใช้ได้กับคีย์บอร์ดและ
                        screen reader โดยไม่ต้องทำอะไรเพิ่ม */}
                    <div className="mt-2 flex gap-1">
                      {PAGE_STATUSES.filter((other) => other !== status).map((other) => (
                        <button
                          key={other}
                          type="button"
                          disabled={busyPageId === task.id}
                          onClick={() => onSetStatus(task.id, other)}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-xs text-muted-foreground',
                            'hover:bg-accent hover:text-foreground disabled:opacity-50',
                          )}
                          aria-label={`ย้าย “${task.title}” ไป ${statusLabel(other)}`}
                        >
                          → {statusLabel(other)}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}

              {column.length === 0 && (
                <li className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                  ว่าง
                </li>
              )}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
