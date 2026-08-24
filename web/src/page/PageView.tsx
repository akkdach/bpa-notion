import { useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { LastEditedBy, PageIconButton, useEditorName, usePage, useUpdatePage } from '@/features/pages'
import { PageEditor, useYDoc } from '@/features/editor'
import { NotePanel, useAddNote, useNotes } from '@/features/activity'

// ═══════════════════════════════════════════════════════════════════════════
//  PageView — ต่อ metadata ของหน้าเข้ากับเนื้อหา Yjs
// ═══════════════════════════════════════════════════════════════════════════
export function PageView({ pageId }: { pageId: string }) {
  const page = usePage(pageId)
  const updatePage = useUpdatePage()
  const editorName = useEditorName()
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
    // ─────────────────────────────────────────────────────────────────────
    //  เนื้อหากว้างเต็มพื้นที่ ไม่จำกัดที่ 48rem แบบเดิม
    //
    //  ตารางที่ AI เขียนมาและผังงาน mermaid กว้างกว่าคอลัมน์อ่านสบายทั่วไป
    //  การบีบไว้ทำให้ต้องเลื่อนแนวนอนในกล่องเล็ก ๆ ทั้งที่จอมีที่เหลือ
    //
    //  ⚠️ px-12 ไว้ทั้งสองข้างเสมอ — ถ้าปล่อยชิดขอบ drag handle กับปุ่ม + ของ
    //     BlockNote ที่ลอยอยู่ทางซ้ายของบล็อกจะโดนตัดหายไปนอกจอ
    // ─────────────────────────────────────────────────────────────────────
    <article className="w-full px-12 py-12">
      {/* ไอคอนหน้า — วางเหนือชื่อเรื่องแบบ Notion · แก้ได้เฉพาะ editor ขึ้นไป */}
      <div className="mb-1 px-1">
        <PageIconButton
          icon={page.data?.icon}
          canEdit={canEdit}
          onChange={(icon) => updatePage.mutate({ pageId, input: { icon } })}
        />

        {/* ⚠️ ต้องบอกว่าใครแก้ล่าสุด ไม่ใช่แค่เมื่อไหร่ — AI เป็นสมาชิกคนหนึ่งใน
            workspace คำถามว่า "อันนี้ฉันแก้เองหรือ AI แก้" ต้องตอบได้จากหน้านี้ */}
        {page.data !== undefined && (
          <LastEditedBy
            editor={editorName(page.data.lastEditedBy)}
            updatedAt={page.data.updatedAt}
            className="mt-1"
          />
        )}
      </div>

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
