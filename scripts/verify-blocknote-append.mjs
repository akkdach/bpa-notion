#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  พิสูจน์ว่าเนื้อหาที่เซิร์ฟเวอร์เขียนลง Yjs "โหลดกลับใน BlockNote ได้จริง"
//
//      node scripts/verify-blocknote-append.mjs [baseUrl]
//
//  ทำไมต้องมีและทำไมต้องเข้มกว่าเทสอื่น:
//
//  นี่คือจุดเดียวที่เซิร์ฟเวอร์เขียน Yjs (ที่อื่นมองเป็น bytea ทึบโดยเจตนา)
//  และรูปร่างที่ผิดไม่ได้ทำให้ "render พลาด" แต่ทำ "ข้อมูลหายจริง" สองแบบ:
//
//    1. element เดียวผิด schema → y-prosemirror ลบ element นั้นแล้วกระจาย
//       การลบไปทุก client
//    2. ระดับบนสุดไม่ใช่ blockGroup เดียว → tr.replace() throw นอก try/catch
//       → editor ไม่ render เลยทุกเครื่อง และไม่ self-heal
//
//  ⚠️ ข้อค้นพบสำคัญ: yXmlFragmentToProseMirrorRootNode "ไม่ validate"
//     ป้อนรูปร่างผิดเข้าไปมันคืน node ที่ผิดกลับมาเฉย ๆ ไม่ throw
//     ตัวที่จับได้คือ node.check() ของ ProseMirror ซึ่งเทียบกับ content expression
//     จริงของ schema — ทดสอบแล้วว่ามันจับกรณี "ไม่มี blockGroup ครอบ" ได้
//     ถ้าไม่เรียก check() เทสนี้จะผ่านทั้งที่รูปร่างพัง
//
//  ⚠️ ใช้ schema จริงจาก BlockNoteEditor.create() ไม่ใช่ schema ที่เขียนเลียนแบบ
//     ถ้าเลียนแบบ เทสจะพิสูจน์แค่ว่า "ตรงกับสิ่งที่เราคิด" ไม่ใช่ "ตรงกับของจริง"
//
//  ต้องมี API รันอยู่ก่อน:  dotnet run --project api
// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️ ใช้ไลบรารีจาก web/node_modules — ตัวเดียวกับที่เบราว์เซอร์ใช้จริง
//     ถ้าติดตั้งสำเนาของตัวเองใน scripts/ เทสจะพิสูจน์แค่ว่า "ตรงกับเวอร์ชันที่
//     เทสใช้" ไม่ใช่ "ตรงกับเวอร์ชันที่แอปใช้" ซึ่งเป็นคนละเรื่องกันกับ 0.x
//     ⚠️ ต้องโหลด "entry ฝั่ง ESM" ให้ถูก — createRequire().resolve() คืนไฟล์ .cjs
//        ของ @blocknote/core ซึ่งเรียก document.createElement ตั้งแต่ตอนโหลดโมดูล
//        แล้วพังทันทีใน Node ที่ไม่มี DOM ส่วน entry ฝั่ง ESM ไม่แตะ DOM ตอนโหลด
//        จึงต้องอ่าน exports["."].import จาก package.json เอง
import { readFile } from 'node:fs/promises'

async function importEsm(name) {
  const dir = new URL(`../web/node_modules/${name}/`, import.meta.url)
  const pkg = JSON.parse(await readFile(new URL('package.json', dir), 'utf8'))
  const entry = pkg.exports?.['.']?.import ?? pkg.module ?? pkg.main
  return import(new URL(entry, dir).href)
}

const Y = await importEsm('yjs')
const { BlockNoteEditor, markdownToHTML } = await importEsm('@blocknote/core')
const { yXmlFragmentToProseMirrorRootNode } = await importEsm('y-prosemirror')

const BASE = process.argv[2] ?? 'http://localhost:5081/api/v1'

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }

let passed = 0
let failed = 0
const failures = []

function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`  ${C.green}✓${C.off} ${label}`) }
  else {
    failed++
    failures.push(label)
    console.log(`  ${C.red}✗${C.off} ${label}${detail ? `\n      ${C.dim}${detail}${C.off}` : ''}`)
  }
}

function section(title) { console.log(`\n${C.bold}${C.yellow}── ${title} ──${C.off}`) }

const stamp = String(Date.now() % 1_000_000)

async function api(path, { method = 'POST', body, token, workspaceId, raw = false } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId

  const response = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (raw) {
    return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) }
  }

  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ประกอบเอกสารจาก /ydoc — รูปแบบ [u32 count][u32 len][bytes]…
//  frame 0 คือ snapshot (ยาว 0 ถ้ายังไม่เคย compact)
// ═══════════════════════════════════════════════════════════════════════════
function decodeFrames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(0, true)

  const frames = []
  let offset = 4

  for (let i = 0; i < count; i++) {
    const length = view.getUint32(offset, true)
    offset += 4
    frames.push(bytes.subarray(offset, offset + length))
    offset += length
  }

  return frames
}

function buildDoc(frames) {
  const doc = new Y.Doc()
  for (const frame of frames) {
    if (frame.length > 0) Y.applyUpdate(doc, frame)
  }
  return doc
}

// ═══════════════════════════════════════════════════════════════════════════
//  oracle ของการแปลง markdown → ชนิดบล็อก
//
//  ⚠️ นี่คือสิ่งที่ BlockNoteWriter.cs อ้างว่า "ไม่มี" ตอนให้เหตุผลว่าทำไมถึงรับ
//     แค่ย่อหน้า — @blocknote/core export `markdownToHTML()` ซึ่งเป็น parser
//     markdown ที่เขียนเองไม่มี dependency และ **ทำงานใน Node เปล่า ๆ ได้**
//     (ตัวเต็ม `markdownToBlocks` ใช้ไม่ได้ — มันเรียก document.createElement)
//
//     ลำดับชนิดบล็อกที่คาดหวังจึงมาจาก parser ของ BlockNote เอง ไม่ใช่จากสิ่งที่
//     เราคิดว่าถูก ซึ่งเป็นคนละเรื่องกันโดยสิ้นเชิงกับไลบรารีเวอร์ชัน 0.x
// ═══════════════════════════════════════════════════════════════════════════
function expectedBlockTypes(html) {
  const types = []
  const lists = []          // 'ul' | 'ol' — ซ้อนกันได้
  let quoteDepth = 0
  let pendingItem = null    // ชนิดของ <li> ที่รอ <p> แรกของมัน

  const tags = /<(\/?)([a-z0-9]+)([^>]*)>/gi

  for (let m = tags.exec(html); m !== null; m = tags.exec(html)) {
    const [, closing, rawName, attrs] = m
    const name = rawName.toLowerCase()

    if (closing) {
      if (name === 'ul' || name === 'ol') lists.pop()
      else if (name === 'blockquote') quoteDepth--
      continue
    }

    if (name === 'ul' || name === 'ol') { lists.push(name); continue }
    if (name === 'blockquote') { quoteDepth++; continue }

    if (name === 'li') {
      // checkListItem รู้ได้จาก <input type="checkbox"> ที่ตามมาทันที
      const rest = html.slice(m.index + m[0].length)
      pendingItem = rest.startsWith('<input type="checkbox"')
        ? 'checkListItem'
        : (lists.at(-1) === 'ol' ? 'numberedListItem' : 'bulletListItem')
      continue
    }

    if (name === 'p') {
      // <p> ตัวแรกใน <li> คือ "เนื้อของรายการ" ไม่ใช่ย่อหน้าแยก
      if (pendingItem !== null) { types.push(pendingItem); pendingItem = null }
      // ⚠️ blockquote หลายย่อหน้า → quote หลายบล็อกพี่น้องกัน ไม่ใช่ quote เดียวที่มีย่อหน้าข้างใน
      //    (schema ของ quote เป็น inline* — มันซ้อนย่อหน้าไม่ได้)
      else types.push(quoteDepth > 0 ? 'quote' : 'paragraph')
      continue
    }

    if (/^h[1-6]$/.test(name)) { types.push('heading'); continue }
    if (name === 'pre') { types.push('codeBlock'); continue }
    if (name === 'hr') { types.push('divider'); continue }
  }

  return types
}

/**
 * ไล่เก็บบล็อกตามลำดับที่คนอ่าน — ลงลูกก่อนแล้วค่อยไปพี่น้องถัดไป
 * รองรับลิสต์ซ้อนชั้นไว้ตั้งแต่ต้นเพื่อไม่ต้องแก้ตอน S3
 */
function collectBlocks(blockGroup, out = []) {
  // ⚠️ ยอมรับ null เงียบ ๆ โดยเจตนา — เอกสารที่ว่างเพราะเขียนล้มเหลวต้องทำให้
  //    "เคสที่ assert เนื้อหา" แดง ไม่ใช่ทำให้สคริปต์ crash แล้วซ่อน section ที่เหลือ
  if (!blockGroup) return out

  blockGroup.forEach((container) => {
    const content = container.firstChild
    if (content) out.push(content)

    if (container.childCount > 1 && container.child(1)?.type.name === 'blockGroup') {
      collectBlocks(container.child(1), out)
    }
  })
  return out
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`${C.yellow}═══ ตรวจการเขียนเนื้อหาจากเซิร์ฟเวอร์ ═══${C.off}`)

const editor = BlockNoteEditor.create()
const schema = editor.pmSchema
console.log(`${C.dim}ใช้ schema จริงของ BlockNote — topNode = ${schema.topNodeType.name}${C.off}`)

section('เตรียมบัญชีและหน้า')

const account = {
  email: `เขียนเนื้อหา.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'ผู้ทดสอบการเขียน',
}

const registered = await api('/auth/register', { body: account })
check('สมัครบัญชีใช้แล้วทิ้ง', registered.status === 200, JSON.stringify(registered.body))
const token = registered.body?.data?.accessToken

const ws = await api('/workspaces', { body: { name: `เขียน ${stamp}` }, token })
const workspaceId = ws.body?.data?.id
const as = { token, workspaceId }

const page = await api('/pages', { body: { parentId: null, title: 'หน้าที่ AI จะเขียนใส่' }, ...as })
check('สร้างหน้า', page.status === 201, JSON.stringify(page.body))
const pageId = page.body?.data?.id

section('⚠️ เขียนลงหน้าที่ยังไม่มีใครเปิด (fragment ว่างเปล่า)')
// ═══════════════════════════════════════════════════════════════════════════
//  กรณีที่อันตรายที่สุด — ต้องสร้าง blockGroup เองเพราะยังไม่มี
//  ถ้าทำผิดตรงนี้ editor จะไม่ render เลยทุกเครื่องและไม่ self-heal
// ═══════════════════════════════════════════════════════════════════════════

const first = ['สรุปยอดขายไตรมาสสาม', 'ยอดรวมเติบโตขึ้นจากสูตรข้าวผัดกระเพราไก่']

const wrote = await api(`/pages/${pageId}/content/paragraphs`, {
  body: { paragraphs: first }, ...as,
})
check('เขียนย่อหน้าลงหน้าว่างได้', wrote.status === 200, JSON.stringify(wrote.body))
check('บอกจำนวนย่อหน้าที่เขียน', wrote.body?.data?.paragraphCount === 2,
  JSON.stringify(wrote.body?.data))

const doc1 = await api(`/pages/${pageId}/ydoc`, { method: 'GET', raw: true, ...as })
check('ดึงเอกสารกลับมาได้', doc1.status === 200, `ได้ ${doc1.status}`)

const ydoc1 = buildDoc(decodeFrames(doc1.bytes))
const frag1 = ydoc1.getXmlFragment('blocknote')

check('root fragment ชื่อ blocknote มีเนื้อหา', frag1.length > 0, `length = ${frag1.length}`)

let node1
try {
  node1 = yXmlFragmentToProseMirrorRootNode(frag1, schema)
  check('แปลงเป็น ProseMirror node ได้', true)
} catch (error) {
  check('แปลงเป็น ProseMirror node ได้', false, error.message)
}

if (node1) {
  // ⚠️ เคสตัดสิน — ตัวเดียวที่จับรูปร่างผิดได้
  try {
    node1.check()
    check('node.check() ผ่าน (รูปร่างตรงกับ schema จริงของ BlockNote)', true)
  } catch (error) {
    check('node.check() ผ่าน (รูปร่างตรงกับ schema จริงของ BlockNote)', false, error.message)
  }

  check('ระดับบนสุดเป็น blockGroup เดียวเป๊ะ',
    node1.childCount === 1 && node1.firstChild?.type.name === 'blockGroup',
    `childCount=${node1.childCount} first=${node1.firstChild?.type.name}`)

  const blocks = node1.firstChild
  check('ได้ blockContainer ครบสองอัน', blocks?.childCount === 2, `ได้ ${blocks?.childCount}`)

  check('ข้อความไทยครบและเรียงถูก',
    node1.textContent === first.join(''),
    `${JSON.stringify(node1.textContent)} ≠ ${JSON.stringify(first.join(''))}`)

  const ids = []
  blocks?.forEach((child) => ids.push(child.attrs?.id))
  check('ทุก blockContainer มี id ที่ไม่ซ้ำกัน',
    ids.length === 2 && ids.every((id) => typeof id === 'string' && id.length > 0)
    && new Set(ids).size === ids.length,
    JSON.stringify(ids))
}

section('เขียนซ้ำต้อง "ต่อท้าย" ไม่ใช่ทับของเดิม')

const second = ['เดือนกันยายนยังไม่ปิดงบ']
const again = await api(`/pages/${pageId}/content/paragraphs`, {
  body: { paragraphs: second }, ...as,
})
check('เขียนรอบสองได้', again.status === 200, JSON.stringify(again.body))

const doc2 = await api(`/pages/${pageId}/ydoc`, { method: 'GET', raw: true, ...as })
const ydoc2 = buildDoc(decodeFrames(doc2.bytes))
const node2 = yXmlFragmentToProseMirrorRootNode(ydoc2.getXmlFragment('blocknote'), schema)

try {
  node2.check()
  check('node.check() ยังผ่านหลังเขียนซ้ำ', true)
} catch (error) {
  check('node.check() ยังผ่านหลังเขียนซ้ำ', false, error.message)
}

check('ยังมี blockGroup เดียว ไม่ได้สร้างซ้ำ',
  node2.childCount === 1 && node2.firstChild?.type.name === 'blockGroup',
  `childCount=${node2.childCount}`)
check('มีย่อหน้ารวมสามอัน (ของเดิมไม่หาย)',
  node2.firstChild?.childCount === 3, `ได้ ${node2.firstChild?.childCount}`)
check('ข้อความเดิมยังอยู่ครบทุกไบต์',
  node2.textContent === [...first, ...second].join(''),
  JSON.stringify(node2.textContent))

section('ขึ้นบรรทัดในย่อหน้าเดียวต้องถูกแตกให้')
// ProseMirror text node ไม่เก็บ newline เป็นโครงสร้าง ถ้าไม่แตกให้ ข้อความจะติดกันหมด

const multiline = await api(`/pages/${pageId}/content/paragraphs`, {
  body: { paragraphs: ['บรรทัดหนึ่ง\nบรรทัดสอง'] }, ...as,
})
check('รับข้อความที่มีขึ้นบรรทัดได้', multiline.status === 200, JSON.stringify(multiline.body))
check('แตกเป็นสองย่อหน้า ไม่ใช่หนึ่ง',
  multiline.body?.data?.paragraphCount === 2, JSON.stringify(multiline.body?.data))

const doc3 = await api(`/pages/${pageId}/ydoc`, { method: 'GET', raw: true, ...as })
const node3 = yXmlFragmentToProseMirrorRootNode(
  buildDoc(decodeFrames(doc3.bytes)).getXmlFragment('blocknote'), schema)

try {
  node3.check()
  check('node.check() ยังผ่าน', true)
} catch (error) {
  check('node.check() ยังผ่าน', false, error.message)
}
check('รวมเป็นห้าย่อหน้า', node3.firstChild?.childCount === 5, `ได้ ${node3.firstChild?.childCount}`)

section('ค้นหาต้องเจอข้อความที่เซิร์ฟเวอร์เขียนทันที')
// ถ้า projection ไม่ถูกอัปเดต ข้อความจะค้นไม่เจอจนกว่ามีคนเปิดหน้าในเบราว์เซอร์

const found = await api(`/search?q=${encodeURIComponent('ข้าวผัด')}`, { method: 'GET', ...as })
check('ค้นคำกลางประโยคจากเนื้อหาที่เพิ่งเขียนเจอ',
  found.body?.data?.hits?.some((h) => h.id === pageId),
  JSON.stringify(found.body?.data))

const read = await api(`/pages/${pageId}/content`, { method: 'GET', ...as })
check('อ่านเนื้อหากลับมาเห็นข้อความที่เขียน',
  read.body?.data?.bodyText?.includes('ข้าวผัดกระเพราไก่'),
  read.body?.data?.bodyText)

section('input ที่ผิดรูป')

const empty = await api(`/pages/${pageId}/content/paragraphs`, { body: { paragraphs: [] }, ...as })
check('ไม่มีย่อหน้า → 400', empty.status === 400 && empty.body?.code === 'no_paragraphs',
  `ได้ ${empty.status} ${empty.body?.code}`)

const blank = await api(`/pages/${pageId}/content/paragraphs`, {
  body: { paragraphs: ['   ', '\n'] }, ...as,
})
check('ย่อหน้าว่างล้วน → 400 ไม่ใช่เขียนย่อหน้าเปล่า',
  blank.status === 400, `ได้ ${blank.status} ${blank.body?.code}`)

const tooMany = await api(`/pages/${pageId}/content/paragraphs`, {
  body: { paragraphs: Array.from({ length: 51 }, (_, i) => `ย่อหน้าที่ ${i}`) }, ...as,
})
check('เกินเพดานต่อครั้ง → 400', tooMany.status === 400 && tooMany.body?.code === 'too_many_paragraphs',
  `ได้ ${tooMany.status} ${tooMany.body?.code}`)

// ═══════════════════════════════════════════════════════════════════════════
//  markdown — หัวข้อ ลิสต์ อ้างอิง โค้ด เส้นคั่น
//
//  ใช้หน้าใหม่ ไม่ปนกับหน้าย่อหน้าข้างบน เพื่อให้จำนวนบล็อกที่ assert อ่านง่าย
// ═══════════════════════════════════════════════════════════════════════════
section('markdown → บล็อกครบทุกชนิด')

const mdPage = await api('/pages', { body: { parentId: null, title: 'หน้าที่ AI เขียน markdown' }, ...as })
const mdPageId = mdPage.body?.data?.id

const MERMAID_SOURCE = 'graph TD\n  A[เริ่มงาน] --> B{ตรวจแล้วหรือยัง}\n  B -->|ใช่| C[เสร็จ]'

const markdown = [
  '# รายงานประจำสัปดาห์',
  '',
  'สรุปงานที่ทำเสร็จแล้วพร้อมผังงานขั้นตอนอนุมัติ',
  '',
  '## ขั้นตอนถัดไป',
  '',
  '- ตรวจสอบยอดขายสาขารังสิต',
  '- ปิดงบเดือนกันยายน',
  '',
  '1. ส่งให้หัวหน้าตรวจ',
  '',
  '- [x] เก็บข้อมูลครบแล้ว',
  '- [ ] ยังไม่ได้สรุป',
  '',
  '> ข้อมูลจากระบบบัญชีอาจคลาดเคลื่อนได้',
  '',
  '```mermaid',
  MERMAID_SOURCE,
  '```',
  '',
  '---',
  '',
].join('\n')

const mdWrote = await api(`/pages/${mdPageId}/content/markdown`, { body: { markdown }, ...as })
check('เขียน markdown ลงหน้าว่างได้', mdWrote.status === 200, JSON.stringify(mdWrote.body))

const mdDoc = await api(`/pages/${mdPageId}/ydoc`, { method: 'GET', raw: true, ...as })
let mdNode
try {
  mdNode = yXmlFragmentToProseMirrorRootNode(
    buildDoc(decodeFrames(mdDoc.bytes)).getXmlFragment('blocknote'), schema)
  check('แปลงเป็น ProseMirror node ได้', true)
} catch (error) {
  check('แปลงเป็น ProseMirror node ได้', false, error.message)
}

if (mdNode) {
  try {
    mdNode.check()
    check('node.check() ผ่าน', true)
  } catch (error) {
    check('node.check() ผ่าน', false, error.message)
  }

  check('ระดับบนสุดเป็น blockGroup เดียวเป๊ะ',
    mdNode.childCount === 1 && mdNode.firstChild?.type.name === 'blockGroup',
    `childCount=${mdNode.childCount} first=${mdNode.firstChild?.type.name}`)

  const blocks = collectBlocks(mdNode.firstChild)
  const actualTypes = blocks.map((b) => b.type.name)
  const oracleTypes = expectedBlockTypes(await markdownToHTML(markdown))

  // ⚠️ เคสตัดสินของระยะนี้ — เทียบกับ parser ของ BlockNote เอง
  check('ลำดับชนิดบล็อกตรงกับ markdownToHTML ของ BlockNote',
    JSON.stringify(actualTypes) === JSON.stringify(oracleTypes),
    `ได้      ${JSON.stringify(actualTypes)}\n      คาดหวัง ${JSON.stringify(oracleTypes)}`)

  // ─────────────────────────────────────────────────────────────────────
  //  ⚠️ ข้อนี้สำคัญกว่าที่เห็น
  //
  //  ทดลองแล้วว่า: ถ้าใส่ชื่อ mark ที่ schema ไม่รู้จัก node.check() **ผ่าน**
  //  แต่ข้อความถูกลบทิ้งเงียบ ๆ (textContent เป็นสตริงว่าง) — check() อย่างเดียว
  //  จึงไม่พอ ต้อง assert ข้อความทุกครั้ง
  // ─────────────────────────────────────────────────────────────────────
  for (const phrase of ['รายงานประจำสัปดาห์', 'สาขารังสิต', 'ส่งให้หัวหน้าตรวจ',
    'เก็บข้อมูลครบแล้ว', 'ข้อมูลจากระบบบัญชีอาจคลาดเคลื่อนได้']) {
    check(`ข้อความ "${phrase}" ไม่หาย`, mdNode.textContent.includes(phrase))
  }

  const heading = blocks.find((b) => b.type.name === 'heading')
  // ⚠️ assert บน "สตริง" โดยเจตนา — XmlElement.InsertAttribute รับได้แค่ string
  //    ค่า level จึงมาถึงเบราว์เซอร์เป็น "1" ไม่ใช่ 1 ซึ่ง render ถูก (`h` + `"1"`)
  //    อย่า "แก้" ให้เป็น number — เขียนแบบนั้นไม่ได้
  check('heading มี level เป็นสตริง "1"', String(heading?.attrs?.level) === '1',
    JSON.stringify(heading?.attrs))

  const h2 = blocks.filter((b) => b.type.name === 'heading')[1]
  check('หัวข้อระดับสองได้ level "2"', String(h2?.attrs?.level) === '2', JSON.stringify(h2?.attrs))

  const checks = blocks.filter((b) => b.type.name === 'checkListItem')
  check('- [x] → checked เป็นค่าจริง', Boolean(checks[0]?.attrs?.checked), JSON.stringify(checks[0]?.attrs))
  // ⚠️ "false" เป็นสตริงที่ truthy ใน JS — ถ้าเซิร์ฟเวอร์เขียน checked="false"
  //    ช่องจะติ๊กทั้งที่ markdown บอกว่ายังไม่ติ๊ก ต้องละ attribute ไปเลย
  check('- [ ] → checked ต้องไม่ใช่ค่าจริง (ห้ามเป็นสตริง "false")',
    !checks[1]?.attrs?.checked, JSON.stringify(checks[1]?.attrs))

  const divider = blocks.find((b) => b.type.name === 'divider')
  check('divider ไม่มีลูกเลย', divider?.childCount === 0, `ได้ ${divider?.childCount}`)

  const code = blocks.find((b) => b.type.name === 'codeBlock')
  check('codeBlock มี language = mermaid', code?.attrs?.language === 'mermaid',
    JSON.stringify(code?.attrs))
  check('ซอร์ส mermaid เหมือนเดิมทุกไบต์ รวมการขึ้นบรรทัด',
    code?.textContent === MERMAID_SOURCE,
    `${JSON.stringify(code?.textContent)}\n      ≠ ${JSON.stringify(MERMAID_SOURCE)}`)

  const ids = blocks.map((_, i) => mdNode.firstChild.child(i)?.attrs?.id).filter(Boolean)
  check('ทุก blockContainer มี id ไม่ซ้ำ', new Set(ids).size === ids.length, JSON.stringify(ids))
}

section('⚠️ ตัวหนา/เอียง/ขีดฆ่า/โค้ด/ลิงก์ ต้องไม่ทำข้อความหาย')
// ═══════════════════════════════════════════════════════════════════════════
//  ทดลองแล้วว่าชื่อ mark ที่ schema ไม่รู้จักทำให้ "ข้อความช่วงนั้นถูกลบทิ้ง"
//  โดยที่ node.check() ยังผ่าน — เคสนี้จึง assert textContent ก่อน แล้วค่อย
//  ดูว่า mark ถูกต้องไหม ถ้าสลับลำดับจะอ่านผลผิดตอนพัง
// ═══════════════════════════════════════════════════════════════════════════

const markPage = await api('/pages', { body: { parentId: null, title: 'ข้อความมีรูปแบบ' }, ...as })
const markPageId = markPage.body?.data?.id

const markSource =
  'ปกติ **หนา** และ *เอียง* กับ ~~ขีดฆ่า~~ แล้ว `โค้ด` จบด้วย [ลิงก์](https://x.test/ก)'

const markWrote = await api(`/pages/${markPageId}/content/markdown`, {
  body: { markdown: `${markSource}\n` }, ...as,
})
check('เขียนข้อความที่มีรูปแบบได้', markWrote.status === 200, JSON.stringify(markWrote.body))

const markDoc = await api(`/pages/${markPageId}/ydoc`, { method: 'GET', raw: true, ...as })
let markNode
try {
  markNode = yXmlFragmentToProseMirrorRootNode(
    buildDoc(decodeFrames(markDoc.bytes)).getXmlFragment('blocknote'), schema)
  markNode.check()
  check('node.check() ผ่าน', true)
} catch (error) {
  check('node.check() ผ่าน', false, error.message)
}

if (markNode) {
  // ⚠️ เครื่องหมาย markdown ต้องถูก "ตัดทิ้ง" ไม่ใช่ค้างอยู่ในข้อความ
  const expectedText = 'ปกติ หนา และ เอียง กับ ขีดฆ่า แล้ว โค้ด จบด้วย ลิงก์'
  check('ข้อความครบและไม่มีเครื่องหมาย markdown ค้าง',
    markNode.textContent === expectedText,
    `${JSON.stringify(markNode.textContent)}\n      ≠ ${JSON.stringify(expectedText)}`)

  const runs = []
  markNode.descendants((child) => {
    if (child.isText) runs.push({ text: child.text, marks: child.marks.map((m) => m.type.name) })
  })

  const marksOf = (needle) =>
    runs.find((r) => r.text.includes(needle))?.marks ?? []

  check('"หนา" ได้ mark bold', marksOf('หนา').includes('bold'), JSON.stringify(runs))
  check('"เอียง" ได้ mark italic', marksOf('เอียง').includes('italic'), JSON.stringify(runs))
  check('"ขีดฆ่า" ได้ mark strike', marksOf('ขีดฆ่า').includes('strike'), JSON.stringify(runs))
  check('"โค้ด" ได้ mark code', marksOf('โค้ด').includes('code'), JSON.stringify(runs))
  check('"ลิงก์" ได้ mark link', marksOf('ลิงก์').includes('link'), JSON.stringify(runs))

  // ⚠️ Insert ที่ attributes เป็น null สืบทอดรูปแบบจากตำแหน่งนั้น — ถ้าเขียน
  //    ทีละช่วงแทนที่จะ Format ทับ ข้อความ "ปกติ" จะกลายเป็นตัวหนาไปด้วย
  check('"ปกติ" ที่อยู่ก่อนตัวหนาต้องไม่ติดรูปแบบมาด้วย',
    marksOf('ปกติ').length === 0, JSON.stringify(runs))

  let href = null
  markNode.descendants((child) => {
    const mark = child.marks?.find((m) => m.type.name === 'link')
    if (mark) href = mark.attrs.href
  })
  check('ลิงก์เก็บ href ไว้ครบ (URL ไม่หาย)', href === 'https://x.test/ก', String(href))
}

section('รายการซ้อนชั้น')
// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️ blockGroup ที่ไม่มีลูกผิด content expression (blockGroupChild+) แล้ว
//     y-prosemirror จะลบมันทิ้งและกระจายการลบไปทุกเครื่อง — เคสนี้จึงต้อง
//     assert ทั้ง "รูปร่างถูก" และ "ข้อความไม่หาย"
// ═══════════════════════════════════════════════════════════════════════════

const nestedPage = await api('/pages', { body: { parentId: null, title: 'รายการซ้อนชั้น' }, ...as })
const nestedPageId = nestedPage.body?.data?.id

const nestedMarkdown = [
  '- แม่',
  '  - ลูก',
  '    - หลาน',
  '- แม่คนที่สอง',
  '',
].join('\n')

const nestedWrote = await api(`/pages/${nestedPageId}/content/markdown`, {
  body: { markdown: nestedMarkdown }, ...as,
})
check('เขียนรายการซ้อนชั้นได้', nestedWrote.status === 200, JSON.stringify(nestedWrote.body))

const nestedDoc = await api(`/pages/${nestedPageId}/ydoc`, { method: 'GET', raw: true, ...as })
let nestedNode
try {
  nestedNode = yXmlFragmentToProseMirrorRootNode(
    buildDoc(decodeFrames(nestedDoc.bytes)).getXmlFragment('blocknote'), schema)
  nestedNode.check()
  check('node.check() ผ่าน', true)
} catch (error) {
  check('node.check() ผ่าน', false, error.message)
}

if (nestedNode) {
  check('ข้อความทุกชั้นไม่หาย',
    ['แม่', 'ลูก', 'หลาน', 'แม่คนที่สอง'].every((t) => nestedNode.textContent.includes(t)),
    JSON.stringify(nestedNode.textContent))

  const top = nestedNode.firstChild
  check('ระดับบนสุดมีสองรายการ ไม่ใช่สี่ (ซ้อนจริง ไม่ได้แบน)',
    top?.childCount === 2, `ได้ ${top?.childCount}`)

  const parent = top?.child(0)
  check('รายการแม่มี blockGroup ลูกอยู่ข้าง ๆ เนื้อหา',
    parent?.childCount === 2 && parent.child(1)?.type.name === 'blockGroup',
    `childCount=${parent?.childCount} second=${parent?.child(1)?.type.name}`)

  // ไม่มี blockGroup ว่างสักอันในเอกสาร — ตัวที่ว่างคือตัวที่จะถูกลบทิ้ง
  let emptyGroups = 0
  nestedNode.descendants((n) => {
    if (n.type.name === 'blockGroup' && n.childCount === 0) emptyGroups += 1
  })
  check('ไม่มี blockGroup ว่างเลยสักอัน', emptyGroups === 0, `เจอ ${emptyGroups}`)

  const blocks = collectBlocks(nestedNode.firstChild)
  check('ลำดับชนิดบล็อกตรงกับ markdownToHTML ของ BlockNote',
    JSON.stringify(blocks.map((b) => b.type.name))
      === JSON.stringify(expectedBlockTypes(await markdownToHTML(nestedMarkdown))),
    JSON.stringify(blocks.map((b) => b.type.name)))
}

const tooDeep = await api(`/pages/${nestedPageId}/content/markdown`, {
  body: {
    markdown: ['- ก', '  - ข', '    - ค', '      - ง', '        - จ', ''].join('\n'),
  },
  ...as,
})
check('ซ้อนลึกเกินเพดาน → ยังเขียนได้แต่เตือนกลับ',
  tooDeep.status === 200 && (tooDeep.body?.data?.warnings?.length ?? 0) > 0,
  JSON.stringify(tooDeep.body?.data))

const deepDoc = await api(`/pages/${nestedPageId}/ydoc`, { method: 'GET', raw: true, ...as })
const deepNode = yXmlFragmentToProseMirrorRootNode(
  buildDoc(decodeFrames(deepDoc.bytes)).getXmlFragment('blocknote'), schema)
try {
  deepNode.check()
  check('เอกสารยังถูกต้องหลังปรับความลึก', true)
} catch (error) {
  check('เอกสารยังถูกต้องหลังปรับความลึก', false, error.message)
}
check('ข้อความของชั้นที่ลึกเกินไม่หาย',
  ['ก', 'ข', 'ค', 'ง', 'จ'].every((t) => deepNode.textContent.includes(t)),
  JSON.stringify(deepNode.textContent))

section('⚠️ codeBlock ต้องไม่มี mark เด็ดขาด')
// ═══════════════════════════════════════════════════════════════════════════
//  ทดลองแล้วว่านี่คือรูปร่างเดียวที่ทำเอกสาร "ว่างทั้งหน้า":
//  schema ของ codeBlock คือ marks:"" — ใส่ mark เข้าไปแล้วข้อความถูกลบ
//  → codeBlock ว่าง → blockGroup ว่าง → node.check() พังที่ระดับ doc
// ═══════════════════════════════════════════════════════════════════════════

const codePage = await api('/pages', { body: { parentId: null, title: 'โค้ดที่มี markdown ข้างใน' }, ...as })
const codePageId = codePage.body?.data?.id

const trickySource = 'ตัวอย่าง **ไม่ควรกลายเป็นตัวหนา** และ [ไม่ใช่ลิงก์](http://x.test)'
const tricky = await api(`/pages/${codePageId}/content/markdown`, {
  body: { markdown: ['```text', trickySource, '```', ''].join('\n') }, ...as,
})
check('เขียนโค้ดบล็อกที่มีสัญลักษณ์ markdown ข้างในได้', tricky.status === 200, JSON.stringify(tricky.body))

const codeDoc = await api(`/pages/${codePageId}/ydoc`, { method: 'GET', raw: true, ...as })
let codeNode
try {
  codeNode = yXmlFragmentToProseMirrorRootNode(
    buildDoc(decodeFrames(codeDoc.bytes)).getXmlFragment('blocknote'), schema)
  codeNode.check()
  check('node.check() ผ่าน (เอกสารไม่ว่าง)', true)
} catch (error) {
  check('node.check() ผ่าน (เอกสารไม่ว่าง)', false, error.message)
}

if (codeNode) {
  const block = collectBlocks(codeNode.firstChild)[0]
  check('ข้อความในโค้ดบล็อกรอดครบทุกไบต์ ไม่ถูกตีความเป็น markdown',
    block?.textContent === trickySource, JSON.stringify(block?.textContent))

  let markCount = 0
  block?.descendants((n) => { markCount += n.marks.length })
  check('ไม่มี mark สักตัวในโค้ดบล็อก', markCount === 0, `เจอ ${markCount}`)
}

section('markdown ที่รองรับไม่ได้ต้องลดรูปแล้วรายงาน ไม่ใช่ทิ้งเงียบ ๆ')
// ผู้เรียกคือ LLM ที่มองผลลัพธ์ไม่เห็น — เงียบแปลว่ามันเชื่อว่าเขียนตารางไปแล้ว

const degradePage = await api('/pages', { body: { parentId: null, title: 'ของที่รับไม่ได้' }, ...as })
const degradePageId = degradePage.body?.data?.id

const withTable = [
  '| สาขา | ยอดขาย |',
  '|---|---|',
  '| รังสิต | 120,000 |',
  '',
].join('\n')

const degraded = await api(`/pages/${degradePageId}/content/markdown`, {
  body: { markdown: withTable }, ...as,
})
check('ตาราง → 200 ไม่ใช่ 400', degraded.status === 200, JSON.stringify(degraded.body))
check('บอกกลับว่าถูกลดรูปอะไรไป',
  Array.isArray(degraded.body?.data?.warnings) && degraded.body.data.warnings.length > 0,
  JSON.stringify(degraded.body?.data))

const degradedDoc = await api(`/pages/${degradePageId}/ydoc`, { method: 'GET', raw: true, ...as })
const degradedNode = yXmlFragmentToProseMirrorRootNode(
  buildDoc(decodeFrames(degradedDoc.bytes)).getXmlFragment('blocknote'), schema)
check('ข้อมูลในตารางไม่หาย', degradedNode.textContent.includes('รังสิต')
  && degradedNode.textContent.includes('120,000'), JSON.stringify(degradedNode.textContent))

section('markdown เขียนซ้ำต้องต่อท้าย และค้นหาต้องเจอ')

const mdAgain = await api(`/pages/${mdPageId}/content/markdown`, {
  body: { markdown: '## หัวข้อที่เพิ่มทีหลัง\n' }, ...as,
})
check('เขียน markdown รอบสองได้', mdAgain.status === 200, JSON.stringify(mdAgain.body))

const mdDoc2 = await api(`/pages/${mdPageId}/ydoc`, { method: 'GET', raw: true, ...as })
const mdNode2 = yXmlFragmentToProseMirrorRootNode(
  buildDoc(decodeFrames(mdDoc2.bytes)).getXmlFragment('blocknote'), schema)
check('ของเดิมยังอยู่ครบ', mdNode2.textContent.includes('รายงานประจำสัปดาห์')
  && mdNode2.textContent.includes('หัวข้อที่เพิ่มทีหลัง'), JSON.stringify(mdNode2.textContent))

// คำกลางประโยค — คำต้นประโยคผ่านได้แม้ tokenizer พัง (prefix match)
const mdFound = await api(`/search?q=${encodeURIComponent('บัญชี')}`, { method: 'GET', ...as })
check('ค้นคำกลางประโยคจาก markdown ที่เพิ่งเขียนเจอ',
  mdFound.body?.data?.hits?.some((h) => h.id === mdPageId), JSON.stringify(mdFound.body?.data))

const mdRead = await api(`/pages/${mdPageId}/content`, { method: 'GET', ...as })
// AI ต้องอ่านซอร์สผังงานกลับมาได้ ไม่งั้นมันแก้ผังที่ตัวเองเขียนไม่ได้
check('อ่านกลับมาเห็นซอร์สของผังงานด้วย',
  mdRead.body?.data?.bodyText?.includes('เริ่มงาน'), mdRead.body?.data?.bodyText)
// ⚠️ projection ฝั่งเซิร์ฟเวอร์ห้ามมี marker — เบราว์เซอร์เขียนทับด้วย blocksToPlainText()
//    ที่ไม่มี marker ถ้าเซิร์ฟเวอร์ใส่ '# ' ผลค้นหาจะสลับรูปแบบทุกครั้งที่มีคนเปิดหน้า
check('projection ไม่มี marker ของ markdown ปนมา',
  !/(^|\n)#{1,6}\s/.test(mdRead.body?.data?.bodyText ?? '')
  && !/(^|\n)[-*]\s/.test(mdRead.body?.data?.bodyText ?? ''),
  JSON.stringify(mdRead.body?.data?.bodyText))

section('เพดานของ markdown')

const tooLong = await api(`/pages/${mdPageId}/content/markdown`, {
  body: { markdown: 'ก'.repeat(100_001) }, ...as,
})
check('markdown ยาวเกินเพดาน → 400', tooLong.status === 400, `ได้ ${tooLong.status} ${tooLong.body?.code}`)

const emptyMd = await api(`/pages/${mdPageId}/content/markdown`, { body: { markdown: '   \n\n' }, ...as })
check('markdown ว่างล้วน → 400', emptyMd.status === 400, `ได้ ${emptyMd.status} ${emptyMd.body?.code}`)

section('⚠️ tenant isolation')

const outsider = await api('/auth/register', {
  body: { email: `คนนอก.${stamp}@ทดสอบ.local`, password: account.password, name: 'คนนอก' },
})
const outsiderToken = outsider.body?.data?.accessToken
const outsiderWs = await api('/workspaces', { body: { name: `นอก ${stamp}` }, token: outsiderToken })

const leak = await api(`/pages/${pageId}/content/paragraphs`, {
  body: { paragraphs: ['ไม่ควรเขียนได้'] },
  token: outsiderToken,
  workspaceId: outsiderWs.body?.data?.id,
})
check('คนนอกเขียนเนื้อหาใส่หน้าของ workspace อื่นไม่ได้ → 404',
  leak.status === 404, `ได้ ${leak.status}`)

const afterLeak = await api(`/pages/${pageId}/ydoc`, { method: 'GET', raw: true, ...as })
const nodeAfter = yXmlFragmentToProseMirrorRootNode(
  buildDoc(decodeFrames(afterLeak.bytes)).getXmlFragment('blocknote'), schema)
check('เนื้อหาไม่ถูกแตะต้องหลังคนนอกพยายามเขียน',
  nodeAfter.firstChild?.childCount === 5, `ได้ ${nodeAfter.firstChild?.childCount}`)

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}สรุป${C.off} ${C.green}ผ่าน ${passed}${C.off} / ${failed > 0 ? C.red : C.dim}ไม่ผ่าน ${failed}${C.off}`)

if (failed > 0) {
  console.log(`\n${C.red}เคสที่ไม่ผ่าน:${C.off}`)
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('')
