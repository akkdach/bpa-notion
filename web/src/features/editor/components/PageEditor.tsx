import { useEffect, useMemo } from 'react'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
// ⚠️ ต้อง import จาก '@blocknote/core/yjs' ไม่ใช่ '@blocknote/core/y'
//
//    BlockNote 0.52 มีสอง entry point สำหรับ Yjs สองรุ่น:
//      ./yjs → yjs 13.x (ตัวที่เราใช้ และที่ y-indexeddb รองรับ)
//      ./y   → @y/y 14 ซึ่งยังเป็น release candidate
//
//    ทั้งคู่เป็น optional peer dependency ถ้า import ผิดตัว TypeScript จะบ่นว่า
//    Y.Doc คนละชนิดกัน โดยไม่บอกว่าสาเหตุคือเลือก entry point ผิด
import { CollaborationExtension } from '@blocknote/core/yjs'
import type * as Y from 'yjs'
import { Cloud, CloudOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useResolvedTheme } from '@/features/settings'
import type { DocStatus } from '../hooks/useYDoc'

import '@blocknote/core/fonts/inter.css'
import '@blocknote/shadcn/style.css'

// ═══════════════════════════════════════════════════════════════════════════
//  PageEditor — presentational
//
//  รับ Y.Doc ที่พร้อมแล้วเข้ามา ไม่ fetch เอง ไม่รู้จัก API
//
//  ⚠️ BlockNote เป็น 0.x — pin เวอร์ชันแบบเป๊ะ (ไม่มี ^) ไว้ใน package.json
//     minor bump ของมัน breaking ได้
// ═══════════════════════════════════════════════════════════════════════════

interface PageEditorProps {
  doc: Y.Doc
  status: DocStatus
  editable: boolean
  onChangeProjection: (title: string, plainText: string) => void
}

export function PageEditor({ doc, status, editable, onChangeProjection }: PageEditorProps) {
  const theme = useResolvedTheme()

  // fragment ต้องชื่อเดียวกันทุกที่ ไม่งั้นสองเครื่องจะแก้คนละเอกสาร
  const fragment = useMemo(() => doc.getXmlFragment('blocknote'), [doc])

  const editor = useCreateBlockNote(
    {
      // ─────────────────────────────────────────────────────────────────
      //  ผูก editor เข้ากับ Y.Doc ตั้งแต่ Phase 1
      //
      //  ยังไม่ส่ง provider เพราะยังไม่มี realtime — provider มีไว้ให้ awareness
      //  (เคอร์เซอร์ของคนอื่น) ซึ่งเป็นงาน Phase 2 ตอนนั้นแค่เพิ่ม provider
      //  เข้ามาตรงนี้ ไม่ต้องแก้อย่างอื่น
      //
      //  การผูก Y.Doc ตั้งแต่ตอนนี้สำคัญ: ถ้า Phase 1 เก็บเป็น JSON แล้วค่อย
      //  ย้ายมาเป็น CRDT ทีหลัง เท่ากับต้องเขียน editor ใหม่ทั้งหมด
      // ─────────────────────────────────────────────────────────────────
      extensions: [
        CollaborationExtension({
          fragment,
          user: { name: '', color: '' },
        }),
      ],
    },
    [fragment],
  )

  // ─── ส่ง projection เมื่อเนื้อหาเปลี่ยน ──────────────────────────────────
  // debounce อยู่ใน useYDoc แล้ว ที่นี่แค่รายงานทุกครั้งที่เปลี่ยน
  useEffect(() => {
    if (editor === undefined) return

    const report = () => {
      const blocks = editor.document
      const plainText = blocksToPlainText(blocks)

      // บรรทัดแรกที่มีข้อความคือชื่อหน้า — พฤติกรรมเดียวกับ Notion
      const title = plainText.split('\n').find((line) => line.trim().length > 0) ?? ''

      onChangeProjection(title.trim().slice(0, 200), plainText)
    }

    return editor.onChange(report)
  }, [editor, onChangeProjection])

  return (
    <div className="relative">
      <SaveIndicator status={status} />

      <BlockNoteView
        editor={editor}
        editable={editable}
        // ⚠️ ต้องส่ง theme เข้าไปเอง — BlockNote ไม่ได้ดูคลาส .dark บน <html>
        //    ปล่อยไว้เป็น "light" แบบเดิมแล้วสลับเป็นโหมดมืด จะได้กล่องขาวโพลน
        //    อยู่กลางหน้าจอดำ
        theme={theme}
        // ภาษาไทยไม่มีช่องว่างระหว่างคำ ต้องบอกเบราว์เซอร์ให้ตัดบรรทัดถูก
        // (กฎ CSS อยู่ใน index.css ที่ :lang(th))
        lang="th"
      />
    </div>
  )
}

function SaveIndicator({ status }: { status: DocStatus }) {
  if (status === 'ready') return null

  const config = {
    loading: { icon: Loader2, text: 'กำลังโหลด…', spin: true, tone: 'text-muted-foreground' },
    saving: { icon: Cloud, text: 'กำลังบันทึก…', spin: false, tone: 'text-muted-foreground' },
    offline: {
      icon: CloudOff,
      text: 'ออฟไลน์ — เนื้อหาถูกเก็บไว้ในเครื่องและจะส่งเมื่อกลับมาออนไลน์',
      spin: false,
      tone: 'text-warning',
    },
    error: { icon: CloudOff, text: 'บันทึกไม่สำเร็จ', spin: false, tone: 'text-destructive' },
    ready: { icon: Cloud, text: '', spin: false, tone: '' },
  }[status]

  const Icon = config.icon

  return (
    <div className={cn('absolute right-2 top-2 z-10 flex items-center gap-1.5 text-xs', config.tone)}>
      <Icon className={cn('size-3.5', config.spin && 'animate-spin')} aria-hidden />
      <span>{config.text}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  แกะ plain text จากโครงสร้าง block
//
//  เซิร์ฟเวอร์อ่าน Yjs ไม่ได้ (เก็บเป็น bytea ทึบ ๆ) การแปลงจึงต้องเกิดที่นี่
//  แล้วส่งขึ้นไปเป็น projection สำหรับ index ค้นหาและ title ใน sidebar
// ═══════════════════════════════════════════════════════════════════════════
interface BlockLike {
  content?: unknown
  children?: BlockLike[]
}

function blocksToPlainText(blocks: readonly BlockLike[]): string {
  return blocks
    .map((block) => {
      const own = extractText(block.content)
      const nested = block.children ? blocksToPlainText(block.children) : ''
      return [own, nested].filter((part) => part.length > 0).join('\n')
    })
    .filter((line) => line.length > 0)
    .join('\n')
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((item) => {
      if (item === null || typeof item !== 'object') return ''
      const record = item as { text?: unknown; content?: unknown }
      if (typeof record.text === 'string') return record.text
      return extractText(record.content)
    })
    .join('')
}
