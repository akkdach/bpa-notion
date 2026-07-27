import { useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { usePage } from '@/features/pages'
import { PageEditor, useYDoc } from '@/features/editor'
import { NotePanel, useAddNote, useNotes } from '@/features/activity'

// ═══════════════════════════════════════════════════════════════════════════
//  PageView — ต่อ metadata ของหน้าเข้ากับเนื้อหา Yjs
// ═══════════════════════════════════════════════════════════════════════════
export function PageView({ pageId }: { pageId: string }) {
  const page = usePage(pageId)
  const { doc, status, reportProjection } = useYDoc(pageId)
  const notes = useNotes(pageId)
  const addNote = useAddNote(pageId)

  // useCallback เพื่อไม่ให้ effect ที่ subscribe onChange ใน PageEditor
  // ถูก unsubscribe/resubscribe ทุกครั้งที่ render
  const handleProjection = useCallback(
    (title: string, plainText: string) => reportProjection(title, plainText),
    [reportProjection],
  )

  if (page.isLoading || doc === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    )
  }

  if (page.error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-destructive">{page.error.message}</p>
      </div>
    )
  }

  const role = page.data?.myRole
  const canEdit = role === 'editor' || role === 'full'
  // เขียนบันทึกได้ตั้งแต่ commenter ขึ้นไป — ไม่ต้องแก้เอกสารได้
  const canComment = canEdit || role === 'commenter'

  return (
    <article className="mx-auto max-w-3xl px-12 py-12">
      <PageEditor
        doc={doc}
        status={status}
        editable={canEdit}
        onChangeProjection={handleProjection}
      />

      <NotePanel
        notes={notes.data ?? []}
        isLoading={notes.isLoading}
        isSending={addNote.isPending}
        {...(canComment ? { onAdd: (body: string) => addNote.mutateAsync(body) } : {})}
      />
    </article>
  )
}
