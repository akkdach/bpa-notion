import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusChip } from './StatusChip'
import type { PageNode } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  TrashList — presentational
//
//  API มี /pages/trash, /{id}/restore และ /{id}/purge มาตั้งแต่ Phase 1
//  แต่ไม่เคยมี UI เรียกเลย = ลบแล้วกู้คืนไม่ได้จากหน้าเว็บ
//  เรื่องนี้สำคัญขึ้นมากเมื่อ AI ลบหน้าได้ด้วย — ต้องมีทางถอย
//
//  ⚠️ restore กู้ทั้ง subtree แบบไม่มีเงื่อนไข รวมลูกที่ถูกลบไปก่อนหน้านั้นแล้ว
//     (ดู RestoreSubtreeAsync) จึงย้อน restore ไม่ได้ด้วยการลบซ้ำ
//     ข้อความในปุ่มต้องไม่สัญญาว่าย้อนได้
// ═══════════════════════════════════════════════════════════════════════════

interface TrashListProps {
  nodes: PageNode[]
  /** owner/admin เท่านั้นที่ purge ได้ — ฝั่ง API บังคับอยู่แล้ว ที่นี่แค่ซ่อนปุ่ม */
  canPurge: boolean
  busyPageId?: string | undefined
  onRestore: (pageId: string) => void
  onPurge: (pageId: string) => void
}

export function TrashList({ nodes, canPurge, busyPageId, onRestore, onPurge }: TrashListProps) {
  if (nodes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        ถังขยะว่าง
      </p>
    )
  }

  return (
    <ul className="divide-y rounded-lg border">
      {nodes.map((node) => (
        <li key={node.id} className="flex items-center gap-3 px-4 py-3">
          <span aria-hidden className="shrink-0">{node.icon ?? '📄'}</span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              {node.title.length > 0 ? node.title : 'ไม่มีชื่อ'}
            </p>
            <p className="text-xs text-muted-foreground">
              ลบเมื่อ {formatDeletedAt(node.deletedAt)}
            </p>
          </div>

          {/* กดไม่ได้ในถังขยะ — เปลี่ยนสถานะหน้าที่ถูกลบไม่มีความหมาย */}
          <StatusChip status={node.status} />

          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={busyPageId === node.id}
              onClick={() => onRestore(node.id)}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              กู้คืน
            </Button>

            {canPurge && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                disabled={busyPageId === node.id}
                onClick={() => onPurge(node.id)}
              >
                <Trash2 className="size-3.5" aria-hidden />
                ลบถาวร
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function formatDeletedAt(deletedAt: string | undefined): string {
  if (deletedAt === undefined) return 'ไม่ทราบเวลา'

  // ระบบตั้ง locale th-TH และ timezone Asia/Bangkok ไว้แล้ว (ดู playwright.config)
  return new Date(deletedAt).toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
