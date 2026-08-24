import { LastEditedBy } from './LastEditedBy'
import { useEditorName } from '../hooks/useEditorName'
import { usePage } from '../hooks/usePageTree'

// ═══════════════════════════════════════════════════════════════════════════
//  PageHeaderMeta — "ใครแก้หน้านี้ล่าสุด" สำหรับแถบบนสุดที่ติดอยู่กับที่
//
//  ⚠️ เคยวางบรรทัดนี้ไว้ใต้ไอคอนหน้า (บนสุดของเอกสาร) แล้วผู้ใช้หาไม่เจอ
//     เพราะหน้ายาวกว่าจอ พออ่านอยู่กลางหน้ามันเลื่อนพ้นไปแล้ว — คำถาม
//     "ใครแก้หน้านี้" เกิดตอนกำลังอ่านเนื้อหา ไม่ใช่ตอนอยู่บนสุด
//     แถบบนไม่เลื่อนตามเนื้อหา จึงตอบได้ทุกจังหวะ
// ═══════════════════════════════════════════════════════════════════════════

export function PageHeaderMeta({ pageId }: { pageId: string }) {
  const page = usePage(pageId)
  const editorName = useEditorName()

  if (page.data === undefined) return null

  return (
    <LastEditedBy
      editor={editorName(page.data.lastEditedBy)}
      updatedAt={page.data.updatedAt}
      className="truncate"
    />
  )
}
