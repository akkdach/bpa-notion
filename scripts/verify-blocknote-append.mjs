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
const { BlockNoteEditor } = await importEsm('@blocknote/core')
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
