import { createExtension } from '@blocknote/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorState, Transaction } from 'prosemirror-state'
import type { Node as PmNode } from 'prosemirror-model'
// ⚠️ import type ล้วน — ตัว mermaid จริงถูกโหลดด้วย dynamic import เท่านั้น
//    (บรรทัดนี้ไม่ทำให้มันเข้า bundle ของหน้าแรก)
import type * as mermaidNamespace from 'mermaid'

// ═══════════════════════════════════════════════════════════════════════════
//  แสดง ```mermaid เป็นแผนภาพจริง
//
//  ⚠️ ทำเป็น ProseMirror plugin ที่วาดทับด้วย decoration — **ไม่แตะ schema เลย**
//
//     ทางที่ไม่เลือกและเหตุผล:
//
//     · block ชนิดใหม่ชื่อ "mermaid" — ทดลองแล้วว่า node ที่ schema ไม่รู้จัก
//       ถูก y-prosemirror "ลบออกจาก Y.Doc แล้วกระจายการลบไปทุกเครื่อง"
//       แท็บที่เปิดค้างด้วยโค้ดรุ่นเก่าจะลบผังงานของทุกคนทิ้ง
//
//     · override spec ของ codeBlock — createCodeBlockSpec ฝัง renderer ไว้ใน
//       NodeView ผ่าน closure การ spread ทับ implementation.render จึงไม่มีผล
//       ต้องก๊อป render/parse/toExternalHTML ของ BlockNote มาเองราว 150 บรรทัด
//       ซึ่งคือการ vendor-patch ที่ PLAN.md ห้ามไว้ (และทำให้ติดอยู่กับรุ่นเก่า)
//
//     ผลของการไม่แตะ schema: เอกสารยังเป็น codeBlock มาตรฐานทุกประการ
//     เซิร์ฟเวอร์เขียนได้ด้วย node ที่มีอยู่แล้ว ค้นหาเจอ AI อ่านกลับได้
//     และถ้าไฟล์นี้พังหรือโหลดไม่สำเร็จ ผู้ใช้ก็ยังเห็น "บล็อกโค้ด" ตามปกติ
//     ไม่ใช่เนื้อหาหาย
// ═══════════════════════════════════════════════════════════════════════════

const MERMAID_LANGUAGE = 'mermaid'
const RENDER_TIMEOUT_MS = 5_000
const MAX_SOURCE_LENGTH = 20_000

const key = new PluginKey<MermaidState>('mermaid-preview')

interface MermaidState {
  decorations: DecorationSet
  /** id ของบล็อกที่ผู้ใช้กด "ดูซอร์ส" ไว้ */
  editing: ReadonlySet<string>
}

interface MermaidMeta {
  toggle: string
}

type MermaidModule = typeof mermaidNamespace.default

// ═══════════════════════════════════════════════════════════════════════════
//  โหลด mermaid แบบ lazy
//
//  ⚠️ dynamic import เท่านั้น — mermaid ลาก d3, cytoscape, katex, dompurify มาด้วย
//     หน้า login และหน้าที่ไม่มีผังงานต้องไม่จ่ายค่านี้
//
//  ธีมเป็น global state ของ mermaid (initialize ทั้งโมดูล) จึงตั้งครั้งเดียว
//  ตอนโหลด แล้วสลับด้วย reinitialize เมื่อผู้ใช้เปลี่ยนโหมดมืด/สว่าง
// ═══════════════════════════════════════════════════════════════════════════
let loading: Promise<MermaidModule> | null = null
let loadedTheme: string | null = null

async function loadMermaid(theme: string): Promise<MermaidModule> {
  loading ??= import('mermaid').then(({ default: mermaid }) => mermaid)

  const mermaid = await loading

  if (loadedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      // ⚠️ ไม่มี Content-Security-Policy ที่ไหนในระบบนี้ — DOMPurify ของ mermaid
      //    จึงเป็นชั้นเดียวที่กรอง SVG ที่ได้ ห้ามลดเป็น 'loose'
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'inherit',
    })
    loadedTheme = theme
  }

  return mermaid
}

/** id ที่ไม่ซ้ำต่อการ render หนึ่งครั้ง — mermaid เขียน DOM ชั่วคราวด้วยค่านี้ */
let renderCounter = 0

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('ใช้เวลานานเกินไป')), ms)),
  ])
}

// ═══════════════════════════════════════════════════════════════════════════
//  วาดผังงานลงใน host
//
//  ⚠️ ฟังก์ชันนี้ "ต้องไม่ reject เด็ดขาด" — ผู้เรียกอยู่ใน toDOM ของ decoration
//     ซึ่ง throw ไม่ได้ (ProseMirror จะหยุด render ทั้งเอกสาร ระดับเดียวกับ
//     tr.replace() ที่ทำให้ editor ว่างทั้งหน้า)
// ═══════════════════════════════════════════════════════════════════════════
async function renderInto(
  host: HTMLElement, source: string, theme: string, signal: AbortSignal,
): Promise<void> {
  try {
    if (source.trim().length === 0) throw new Error('ยังไม่มีเนื้อหาผังงาน')
    if (source.length > MAX_SOURCE_LENGTH) throw new Error('ผังงานยาวเกินไป')

    const mermaid = await loadMermaid(theme)
    if (signal.aborted) return

    // ⚠️ parse คืน "ParseResult (object)" เมื่อผ่าน และ false เมื่อไม่ผ่าน
    //    ไม่ใช่ boolean ทั้งคู่ — เทียบกับ true ตรง ๆ จะปฏิเสธผังงานที่ถูกต้องทุกอัน
    //    (พลาดมาแล้ว อาการคือทุกผังขึ้น "ไวยากรณ์ไม่ถูกต้อง")
    const parsed = await mermaid.parse(source, { suppressErrors: true })
    if (signal.aborted) return
    if (parsed === false) throw new Error('ไวยากรณ์ mermaid ไม่ถูกต้อง')

    renderCounter += 1
    const { svg } = await withTimeout(
      mermaid.render(`bn-mermaid-${renderCounter}`, source), RENDER_TIMEOUT_MS)
    if (signal.aborted) return

    // ⚠️ parse เป็น XML แล้ว importNode แทน innerHTML — ตัดคำถามเรื่อง
    //    การ inject ออกไปทั้งชั้น ด้วยราคาสามบรรทัด
    const svgDoc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const root = svgDoc.documentElement

    if (root.nodeName === 'parsererror') throw new Error('อ่านผลลัพธ์ SVG ไม่ได้')

    host.replaceChildren(document.importNode(root, true))
    host.classList.remove('bn-mermaid-error')
  } catch (error) {
    if (signal.aborted) return
    showError(host, source, error)
  }
}

/**
 * ⚠️ กล่องผิดพลาดต้องแสดง "ซอร์สเต็ม ๆ" เสมอ ห้ามเป็นกล่องเปล่า
 *    ผังงานที่ AI เขียนพังบ่อย และผู้ใช้ต้องเห็นว่าต้องแก้อะไร
 */
function showError(host: HTMLElement, source: string, error: unknown): void {
  const message = error instanceof Error ? error.message : 'แสดงผังงานไม่สำเร็จ'

  const box = document.createElement('div')
  box.className = 'bn-mermaid-error-body'

  const label = document.createElement('p')
  label.className = 'bn-mermaid-error-label'
  label.textContent = `แสดงผังงานไม่ได้: ${message}`

  const pre = document.createElement('pre')
  pre.textContent = source

  box.append(label, pre)
  host.replaceChildren(box)
  host.classList.add('bn-mermaid-error')
}

// ═══════════════════════════════════════════════════════════════════════════
//  หา codeBlock ที่เป็น mermaid ทั้งหมดในเอกสาร
// ═══════════════════════════════════════════════════════════════════════════
interface MermaidBlock {
  /** ตำแหน่งของ blockContainer ที่ครอบอยู่ — ใช้วาง widget ก่อนเนื้อหา */
  containerPos: number
  contentPos: number
  content: PmNode
  blockId: string
  source: string
}

function findMermaidBlocks(state: EditorState): MermaidBlock[] {
  const found: MermaidBlock[] = []

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer') return true

    const content = node.firstChild
    if (content?.type.name !== 'codeBlock') return true
    // language มาถึงเป็นสตริงเสมอ ทั้งจากเบราว์เซอร์และจากเซิร์ฟเวอร์
    if (String(content.attrs.language ?? '') !== MERMAID_LANGUAGE) return true

    const blockId = String(node.attrs.id ?? pos)
    found.push({
      containerPos: pos,
      contentPos: pos + 1,
      content,
      blockId,
      source: content.textContent,
    })

    return false
  })

  return found
}

function buildDecorations(
  state: EditorState, editing: ReadonlySet<string>, theme: string,
): DecorationSet {
  const decorations: Decoration[] = []

  for (const block of findMermaidBlocks(state)) {
    const showSource = editing.has(block.blockId)

    // ─────────────────────────────────────────────────────────────────
    //  key คือหัวใจของประสิทธิภาพที่นี่
    //
    //  ProseMirror ใช้ DOM ของ widget ซ้ำเมื่อ key เท่าเดิม → mermaid จะ
    //  re-render "เฉพาะตอนซอร์สหรือธีมเปลี่ยนจริง" ไม่ใช่ทุก transaction
    //  (พิมพ์ที่ย่อหน้าอื่นก็เป็น transaction เหมือนกัน)
    // ─────────────────────────────────────────────────────────────────
    const widgetKey = `${block.blockId}|${theme}|${showSource}|${block.source}`

    // ⚠️ วาง widget ไว้เสมอ แม้ตอนกำลังดูซอร์ส — ไม่งั้นปุ่มสลับกลับหายไปด้วย
    //    แล้วผู้ใช้ติดอยู่กับมุมมองซอร์สถาวรจนกว่าจะ reload
    decorations.push(Decoration.widget(
      block.contentPos,
      () => createWidget(block.source, block.blockId, theme, showSource),
      { key: widgetKey, side: -1, ignoreSelection: true },
    ))

    if (!showSource) {
      decorations.push(Decoration.node(
        block.contentPos,
        block.contentPos + block.content.nodeSize,
        { class: 'bn-mermaid-source-hidden' },
      ))
    }
  }

  return DecorationSet.create(state.doc, decorations)
}

function createWidget(
  source: string, blockId: string, theme: string, showSource: boolean,
): HTMLElement {
  const host = document.createElement('div')
  host.className = showSource ? 'bn-mermaid bn-mermaid-editing' : 'bn-mermaid'
  host.setAttribute('data-mermaid-block', blockId)
  // contentEditable=false — ไม่งั้นเคอร์เซอร์เดินเข้าไปในผังงานได้
  host.contentEditable = 'false'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'bn-mermaid-toggle'
  toggle.textContent = showSource ? 'ดูแผนภาพ' : 'ดูซอร์ส'
  toggle.setAttribute('aria-label',
    showSource ? 'กลับไปดูแผนภาพ' : 'ดูซอร์สของผังงาน')
  // ⚠️ ห้ามส่ง async function เข้า addEventListener ตรง ๆ (no-misused-promises)
  toggle.addEventListener('click', (event) => {
    event.preventDefault()
    host.dispatchEvent(new CustomEvent('bn-mermaid-toggle', {
      bubbles: true, detail: blockId,
    }))
  })

  host.append(toggle)

  // ตอนดูซอร์สไม่ต้องวาดอะไร — บล็อกโค้ดของจริงแสดงอยู่ใต้ปุ่มนี้แล้ว
  if (showSource) return host

  const canvas = document.createElement('div')
  canvas.className = 'bn-mermaid-canvas'
  canvas.textContent = 'กำลังวาดผังงาน…'
  host.append(canvas)

  // ─────────────────────────────────────────────────────────────────────
  //  toDOM ต้อง synchronous — คืน host ไปก่อนแล้วค่อยวาดทีหลัง
  //
  //  AbortController ผูกกับ widget ตัวนี้ ถ้า ProseMirror ทิ้ง DOM ไปก่อน
  //  mermaid จะวาดเสร็จแล้วเขียนลง element ที่ไม่ได้อยู่ในหน้าแล้ว — ไม่ crash
  //  แต่เป็นงานเปล่าและทำให้ error ของรอบเก่าไปโผล่ทับรอบใหม่ได้
  // ─────────────────────────────────────────────────────────────────────
  const controller = new AbortController()
  const observer = new MutationObserver(() => {
    if (!host.isConnected) { controller.abort(); observer.disconnect() }
  })
  if (host.ownerDocument.body) {
    observer.observe(host.ownerDocument.body, { childList: true, subtree: true })
  }

  void renderInto(canvas, source, theme, controller.signal)

  return host
}

// ═══════════════════════════════════════════════════════════════════════════
export const MermaidPreview = createExtension(
  (ctx: { options: { theme?: string } }) => {
    const theme = ctx.options.theme ?? 'light'

    return {
      key: 'mermaid-preview' as const,
      prosemirrorPlugins: [
        new Plugin<MermaidState>({
          key,
          state: {
            init: (_config, state) => ({
              editing: new Set<string>(),
              decorations: buildDecorations(state, new Set(), theme),
            }),
            apply: (tr: Transaction, previous: MermaidState, _old, next) => {
              const meta = tr.getMeta(key) as MermaidMeta | undefined

              if (meta === undefined && !tr.docChanged) {
                return {
                  editing: previous.editing,
                  decorations: previous.decorations.map(tr.mapping, tr.doc),
                }
              }

              const editing = new Set(previous.editing)
              if (meta !== undefined) {
                if (editing.has(meta.toggle)) editing.delete(meta.toggle)
                else editing.add(meta.toggle)
              }

              return { editing, decorations: buildDecorations(next, editing, theme) }
            },
          },
          props: {
            decorations: (state) => key.getState(state)?.decorations ?? DecorationSet.empty,

            handleDOMEvents: {
              'bn-mermaid-toggle': (view, event) => {
                const blockId = (event as CustomEvent<string>).detail
                view.dispatch(view.state.tr.setMeta(key, { toggle: blockId }))
                return true
              },
            },
          },
        }),
      ],
    }
  },
)
