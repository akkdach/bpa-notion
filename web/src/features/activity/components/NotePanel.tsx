import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRelative } from '@/lib/relativeTime'
import { Button } from '@/components/ui/button'
import type { Note } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  NotePanel — presentational
//
//  แผงบันทึกใต้เอกสาร แยกจากเนื้อหาหน้าอย่างชัดเจนโดยเจตนา
//
//  AI เขียนเนื้อหาในหน้าไม่ได้ (เป็น CRDT ที่เซิร์ฟเวอร์เขียนไม่ได้อย่างปลอดภัย)
//  ช่องนี้จึงเป็นที่ที่ AI รายงานความคืบหน้าและตั้งคำถาม — และการที่มันแยกจาก
//  เอกสารเป็นข้อดี ไม่ใช่ข้อจำกัด: เจ้าของรู้ทันทีว่าอะไรคือของตัวเอง อะไรคือ
//  สิ่งที่ AI เพิ่มเข้ามา
// ═══════════════════════════════════════════════════════════════════════════

const MAX_LENGTH = 4000

interface NotePanelProps {
  notes: Note[]
  isLoading?: boolean
  isSending?: boolean
  /** ไม่ส่ง = อ่านอย่างเดียว (ไม่มีสิทธิ์แสดงความเห็น) */
  onAdd?: (body: string) => Promise<unknown>
}

export function NotePanel({ notes, isLoading, isSending, onAdd }: NotePanelProps) {
  const [draft, setDraft] = useState('')

  const trimmed = draft.trim()
  const tooLong = draft.length > MAX_LENGTH
  const canSend = trimmed.length > 0 && !tooLong && isSending !== true

  const submit = () => {
    if (!canSend || onAdd === undefined) return
    void onAdd(trimmed).then(() => setDraft(''))
  }

  return (
    <section className="mt-8 border-t pt-6" aria-label="บันทึกความคืบหน้า">
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
        บันทึกความคืบหน้า
        {notes.length > 0 && ` (${notes.length})`}
      </h2>

      {isLoading === true ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          ยังไม่มีบันทึก — ที่นี่คือที่ที่ AI รายงานความคืบหน้าและตั้งคำถาม
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => {
            const byAgent = note.authorKind === 'agent'

            return (
              <li
                key={note.id}
                className={cn(
                  'rounded-lg border px-3 py-2',
                  byAgent && 'border-warning/40 bg-warning/5',
                )}
              >
                <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden>{byAgent ? '🤖' : '👤'}</span>
                  <span className={cn(byAgent && 'text-warning')}>
                    {note.authorName ?? 'ไม่ทราบผู้เขียน'}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{formatRelative(note.createdAt)}</span>
                </p>
                {/* whitespace-pre-wrap เพราะบันทึกเป็น plain text ที่ขึ้นบรรทัดเองได้ */}
                <p className="whitespace-pre-wrap text-sm">{note.body}</p>
              </li>
            )
          })}
        </ul>
      )}

      {onAdd !== undefined && (
        <div className="mt-4">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl/Cmd+Enter ส่ง — Enter เปล่า ๆ ต้องขึ้นบรรทัดใหม่ได้
              // เพราะบันทึกมักยาวหลายบรรทัด
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
            rows={3}
            placeholder="เขียนบันทึก… (Ctrl+Enter เพื่อส่ง)"
            aria-label="เขียนบันทึกความคืบหน้า"
            className={cn(
              'w-full resize-y rounded-md border bg-background px-3 py-2 text-sm',
              'placeholder:text-muted-foreground focus-visible:outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring',
              tooLong && 'border-destructive',
            )}
          />

          <div className="mt-2 flex items-center justify-between gap-3">
            <span
              className={cn(
                'text-xs',
                tooLong ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {tooLong
                ? `ยาวเกิน ${MAX_LENGTH} ตัวอักษร — เนื้อหายาวควรอยู่ในหน้า ไม่ใช่ในบันทึก`
                : `${draft.length}/${MAX_LENGTH}`}
            </span>

            <Button size="sm" className="gap-1.5" disabled={!canSend} onClick={submit}>
              {isSending === true
                ? <Loader2 className="size-3.5 animate-spin" aria-hidden />
                : <Send className="size-3.5" aria-hidden />}
              บันทึก
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
