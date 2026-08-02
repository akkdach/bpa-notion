#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  อีกครึ่งของ spike — รับ base64 จาก stdout ของ spike-marks.cs
//
//      dotnet run scripts/spike-marks.cs | node scripts/spike-marks.mjs
//
//  ตอบคำถามเดียว: mark ที่ YDotNet เขียน yjs 13.x + schema จริงของ BlockNote
//  อ่านออกไหม และ "ข้อความยังอยู่ครบ" ไหม
//
//  ⚠️ ข้อหลังสำคัญกว่าข้อแรก — ทดลองแล้วว่าถ้าชื่อ mark ไม่ตรงกับ schema
//     ข้อความจะถูกลบทิ้งโดยที่ node.check() ยังผ่าน
// ═══════════════════════════════════════════════════════════════════════════
import { readFile } from 'node:fs/promises'

async function importEsm(name) {
  const dir = new URL(`../web/node_modules/${name}/`, import.meta.url)
  const pkg = JSON.parse(await readFile(new URL('package.json', dir), 'utf8'))
  return import(new URL(pkg.exports?.['.']?.import ?? pkg.module ?? pkg.main, dir).href)
}

const Y = await importEsm('yjs')
const { BlockNoteEditor } = await importEsm('@blocknote/core')
const { yXmlFragmentToProseMirrorRootNode } = await importEsm('y-prosemirror')

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }

let failed = 0
function check(label, ok, detail = '') {
  if (ok) console.log(`  ${C.green}✓${C.off} ${label}`)
  else {
    failed++
    console.log(`  ${C.red}✗${C.off} ${label}${detail ? `\n      ${C.dim}${detail}${C.off}` : ''}`)
  }
}

// fs/promises.readFile ไม่รับ fd 0 — อ่านจาก stream แทน
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const base64 = Buffer.concat(chunks).toString('utf8').trim().split('\n').at(-1)
const update = Uint8Array.from(Buffer.from(base64, 'base64'))

const doc = new Y.Doc()
Y.applyUpdate(doc, update)

const schema = BlockNoteEditor.create().pmSchema
const node = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('blocknote'), schema)

console.log(`${C.bold}spike: mark จาก YDotNet ข้ามไปฝั่ง yjs ได้ไหม${C.off}\n`)

try {
  node.check()
  check('node.check() ผ่าน', true)
} catch (error) {
  check('node.check() ผ่าน', false, error.message)
}

const expected = 'ปกติหนาลิงก์'
check('ข้อความครบทุกไบต์ (ไม่ถูกลบเงียบ ๆ)',
  node.textContent === expected,
  `${JSON.stringify(node.textContent)} ≠ ${JSON.stringify(expected)}`)

const runs = []
node.descendants((child) => {
  if (child.isText) runs.push({ text: child.text, marks: child.marks.map((m) => m.type.name) })
})
console.log(`  ${C.dim}runs: ${JSON.stringify(runs)}${C.off}`)

check('"ปกติ" ไม่มี mark',
  runs.find((r) => r.text === 'ปกติ')?.marks.length === 0)
check('"หนา" มี mark bold',
  runs.find((r) => r.text === 'หนา')?.marks.includes('bold') === true)

const linkRun = runs.find((r) => r.text === 'ลิงก์')
check('"ลิงก์" มี mark link', linkRun?.marks.includes('link') === true)

let href = null
node.descendants((child) => {
  if (child.isText) {
    const mark = child.marks.find((m) => m.type.name === 'link')
    if (mark) href = mark.attrs.href
  }
})
check('link เก็บ href มาด้วย', href === 'https://example.test/ก', String(href))

console.log(failed === 0
  ? `\n${C.green}${C.bold}ทำได้ — ไปต่อ S4 ได้${C.off}\n`
  : `\n${C.red}${C.bold}ไม่ผ่าน ${failed} ข้อ — ยกเลิก mark แล้วลดรูปแทน${C.off}\n`)

process.exit(failed > 0 ? 1 : 0)
