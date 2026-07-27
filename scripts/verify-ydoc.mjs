#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  พิสูจน์ว่าเนื้อหาหน้ารอดจริง — ด้วย Yjs ตัวจริง ไม่ใช่ byte array ปลอม
//
//      node scripts/verify-ydoc.mjs [baseUrl]
//
//  นี่คือข้อพิสูจน์หลักของ Phase 1: "พิมพ์ → refresh → เนื้อหายังอยู่"
//
//  ทดสอบเส้นทางจริงทั้งเส้น:
//    Y.Doc → encodeStateAsUpdate → POST → เก็บลง bytea → GET bootstrap
//    → แกะ frame → applyUpdate ใส่ Y.Doc ใหม่ → ข้อความต้องเหมือนเดิม
//
//  ⚠️ ใช้ yjs จาก web/node_modules — ตัวเดียวกับที่ฝั่ง client จะใช้จริง
//
//  ⚠️ เคสส่วนใหญ่ในไฟล์นี้ใช้ doc.getText('content') ซึ่งเป็น "คนละ root type"
//     กับที่แอปเก็บจริง (doc.getXmlFragment('blocknote') — ดู PageEditor.tsx)
//     มันยังมีค่าเพราะพิสูจน์ commutativity / idempotence / การ prune ซึ่งไม่ขึ้น
//     กับชนิดของ type แต่ "ไม่" พิสูจน์ว่ารูปร่างที่แอปใช้จริงรอด
//
//     หัวข้อสุดท้ายจึงเพิ่มเคสที่ใช้ XmlFragment ของจริง ส่วนการตรวจว่ารูปร่างนั้น
//     ตรงกับ schema ของ BlockNote อยู่ใน verify-blocknote-append.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { createRequire } from 'node:module'

const require = createRequire(new URL('../web/package.json', import.meta.url))
const Y = require('yjs')

const BASE = process.argv[2] ?? 'http://localhost:5081/api/v1'
const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

let passed = 0
let failed = 0

function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`  ${C.green}✓${C.off} ${label}`) }
  else { failed++; console.log(`  ${C.red}✗${C.off} ${label}${detail ? `\n      ${C.dim}${detail}${C.off}` : ''}`) }
}
const section = (t) => console.log(`\n${C.yellow}── ${t} ──${C.off}`)

async function call(method, path, { body, token, workspaceId, binary, raw } = {}) {
  const headers = {}
  if (binary) headers['Content-Type'] = 'application/octet-stream'
  else if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId

  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: binary ?? (body === undefined ? undefined : JSON.stringify(body)),
  })

  if (raw) {
    return {
      status: r.status,
      bytes: new Uint8Array(await r.arrayBuffer()),
      headers: Object.fromEntries(r.headers.entries()),
    }
  }
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

/**
 * แกะรูปแบบ [u32 count][u32 len][bytes]… ที่ API ส่งมา
 * ต้องตรงกับ DocumentService.BuildFrames เป๊ะ ๆ (little-endian)
 */
function parseFrames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(0, true)
  const frames = []
  let offset = 4

  for (let i = 0; i < count; i++) {
    const len = view.getUint32(offset, true)
    offset += 4
    frames.push(bytes.subarray(offset, offset + len))
    offset += len
  }
  return frames
}

/** ประกอบเอกสารขึ้นใหม่จาก frame — เลียนแบบสิ่งที่ client ทำตอนเปิดหน้า */
function rebuild(frames) {
  const doc = new Y.Doc()
  for (const frame of frames) {
    if (frame.length > 0) Y.applyUpdate(doc, frame)
  }
  return doc
}

const readText = (doc) => doc.getText('content').toString()

const stamp = String(Date.now() % 100000)

console.log(`${C.yellow}═══ ตรวจการเก็บเนื้อหา Yjs ═══${C.off}\n`)

// ─── เตรียม ──────────────────────────────────────────────────────────────
const auth = (await call('POST', '/auth/register', {
  body: {
    email: `เอกสาร.${stamp}@ทดสอบ.local`,
    password: 'รหัสผ่านยาวพอสมควรนะครับ',
    name: 'ผู้ทดสอบ เอกสาร',
  },
})).body.data
const token = auth.accessToken
const ws = (await call('POST', '/workspaces', {
  token, body: { name: 'ทดสอบเอกสาร' },
})).body.data
const ctx = { token, workspaceId: ws.id }

const page = (await call('POST', '/pages', {
  ...ctx, body: { parentId: null, title: 'บันทึกการประชุม' },
})).body.data

console.log(`${C.dim}หน้า ${page.id} ใน workspace ${ws.slug}${C.off}`)

// ═══════════════════════════════════════════════════════════════════════════
section('หน้าว่าง')
// ═══════════════════════════════════════════════════════════════════════════
const empty = await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true })
check('bootstrap หน้าที่ยังไม่มีเนื้อหาได้', empty.status === 200, `ได้ ${empty.status}`)
check('มี frame เดียว (snapshot ว่าง)', parseFrames(empty.bytes).length === 1)
check('headSeq = 0', empty.headers['x-doc-head-seq'] === '0')
check('role ติดมากับ header', empty.headers['x-doc-role'] === 'full',
  empty.headers['x-doc-role'])

// ═══════════════════════════════════════════════════════════════════════════
section('พิมพ์แล้วอ่านกลับ')
// ═══════════════════════════════════════════════════════════════════════════
const local = new Y.Doc()
const THAI = 'สรุปการประชุมประจำสัปดาห์ วาระที่ ๑ ทบทวนงานค้าง'

local.getText('content').insert(0, THAI)
const firstUpdate = Y.encodeStateAsUpdate(local)

const posted = await call('POST', `/pages/${page.id}/ydoc/update?yClientId=${local.clientID}`, {
  ...ctx, binary: firstUpdate,
})
check('ส่ง update ได้', posted.status === 200, `ได้ ${posted.status} ${JSON.stringify(posted.body)}`)
check('ได้ seq กลับมา', posted.body?.data?.seq > 0, JSON.stringify(posted.body?.data))

const afterFirst = await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true })
const rebuilt = rebuild(parseFrames(afterFirst.bytes))
check('ข้อความไทยกลับมาครบไม่เพี้ยน', readText(rebuilt) === THAI,
  `ได้ "${readText(rebuilt)}"`)

// ═══════════════════════════════════════════════════════════════════════════
section('แก้หลายครั้งแล้ว replay ทั้ง log')
// ═══════════════════════════════════════════════════════════════════════════
const edits = [
  ' วาระที่ ๒ งบประมาณ',
  ' วาระที่ ๓ แผนไตรมาสหน้า',
  ' มติที่ประชุม: อนุมัติ',
]

for (const text of edits) {
  const before = Y.encodeStateVector(local)
  local.getText('content').insert(readText(local).length, text)
  const delta = Y.encodeStateAsUpdate(local, before)

  const r = await call('POST', `/pages/${page.id}/ydoc/update?yClientId=${local.clientID}`, {
    ...ctx, binary: delta,
  })
  if (r.status !== 200) check(`ส่ง update "${text.trim()}"`, false, `ได้ ${r.status}`)
}

const afterEdits = await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true })
const frames = parseFrames(afterEdits.bytes)
check(`bootstrap มี ${frames.length} frame (snapshot ว่าง + update 4 ก้อน)`, frames.length === 5,
  `ได้ ${frames.length}`)

const replayed = rebuild(frames)
check('replay ทั้ง log แล้วได้ข้อความเดียวกับต้นฉบับ',
  readText(replayed) === readText(local),
  `เซิร์ฟเวอร์ "${readText(replayed).slice(0, 60)}…"\n      ต้นฉบับ    "${readText(local).slice(0, 60)}…"`)

// ─── ลำดับสำคัญ: สลับ frame แล้วต้องยังได้ผลเดิม (CRDT commutative) ───────
const shuffled = [frames[0], ...frames.slice(1).reverse()]
check('สลับลำดับ update แล้วยังได้ผลเดิม (Yjs commutative)',
  readText(rebuild(shuffled)) === readText(local),
  'ถ้าข้อนี้ตก แปลว่าสมมติฐานที่ทำให้เซิร์ฟเวอร์ไม่ต้องแกะ CRDT ผิด')

// ─── ส่ง update ซ้ำ ต้องไม่ทำให้ข้อความซ้ำ (idempotent) ───────────────────
await call('POST', `/pages/${page.id}/ydoc/update?yClientId=${local.clientID}`, {
  ...ctx, binary: firstUpdate,
})
const afterDuplicate = await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true })
check('ส่ง update เดิมซ้ำแล้วข้อความไม่ซ้ำ (idempotent)',
  readText(rebuild(parseFrames(afterDuplicate.bytes))) === readText(local))

// ═══════════════════════════════════════════════════════════════════════════
section('snapshot และการ prune')
// ═══════════════════════════════════════════════════════════════════════════
const headSeq = Number(afterDuplicate.headers['x-doc-head-seq'])
const fullState = Y.encodeStateAsUpdate(local)

const snap1 = await call('POST', `/pages/${page.id}/ydoc/snapshot?upToSeq=${headSeq}`, {
  ...ctx, binary: fullState,
})
check('บันทึก snapshot ได้', snap1.status === 200, `ได้ ${snap1.status}`)
check('snapshot แรกยังไม่ prune อะไร (ยังไม่มีรุ่นก่อนหน้า)',
  snap1.body?.data?.prunedUpdates === 0, JSON.stringify(snap1.body?.data))

// snapshot รุ่นที่สอง → รุ่นแรกกลายเป็น "รุ่นก่อนหน้า" → prune ได้
local.getText('content').insert(readText(local).length, ' ปิดประชุม')
const delta2 = Y.encodeStateAsUpdate(local)
await call('POST', `/pages/${page.id}/ydoc/update`, { ...ctx, binary: delta2 })

const head2 = Number((await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true }))
  .headers['x-doc-head-seq'])

const snap2 = await call('POST', `/pages/${page.id}/ydoc/snapshot?upToSeq=${head2}`, {
  ...ctx, binary: Y.encodeStateAsUpdate(local),
})
check('snapshot รุ่นที่สอง prune update เก่าทิ้ง', snap2.body?.data?.prunedUpdates > 0,
  `prune ${snap2.body?.data?.prunedUpdates} แถว`)

// ⚠️ ข้อพิสูจน์สำคัญที่สุด: หลัง prune แล้วเนื้อหาต้องยังครบ
const afterPrune = await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true })
check('หลัง prune แล้วเนื้อหายังครบ (snapshot ครอบคลุมของที่ลบไป)',
  readText(rebuild(parseFrames(afterPrune.bytes))) === readText(local),
  `ได้ "${readText(rebuild(parseFrames(afterPrune.bytes))).slice(0, 60)}…"`)
check('frame ลดลงเพราะถูก compact แล้ว', parseFrames(afterPrune.bytes).length < frames.length,
  `${parseFrames(afterPrune.bytes).length} frame`)

// ═══════════════════════════════════════════════════════════════════════════
section('ด่านกัน snapshot ที่ไว้ใจไม่ได้')
// ═══════════════════════════════════════════════════════════════════════════
const ahead = await call('POST', `/pages/${page.id}/ydoc/snapshot?upToSeq=${head2 + 9999}`, {
  ...ctx, binary: Y.encodeStateAsUpdate(local),
})
check('upToSeq ที่ล้ำหน้าความจริง → 400', ahead.status === 400, `ได้ ${ahead.status}`)
check('code = snapshot_ahead', ahead.body?.code === 'snapshot_ahead')

// snapshot ที่เนื้อหาหายไปเกือบหมด — client ที่มีบั๊กก็ทำแบบนี้ได้

const lossy = new Y.Doc()
lossy.getText('content').insert(0, 'ก')
const lossySnapshot = Y.encodeStateAsUpdate(lossy)

// สอง client ตัดสินใจ compact ที่ seq เดียวกันเกิดขึ้นได้จริง ไม่ใช่ความผิดพลาด
// ต้องได้ 409 ไม่ใช่ 500 จาก unique index (เจอมาแล้วตอนเทสรอบแรก)
const duplicateSeq = await call('POST', `/pages/${page.id}/ydoc/snapshot?upToSeq=${head2}`, {
  ...ctx, binary: Y.encodeStateAsUpdate(local),
})
check('snapshot ที่ seq ซ้ำ → 409 ไม่ใช่ 500', duplicateSeq.status === 409,
  `ได้ ${duplicateSeq.status}`)
check('code = snapshot_exists', duplicateSeq.body?.code === 'snapshot_exists')

// เดินหน้าอีกก้าวเพื่อให้ได้ seq ใหม่ แล้วค่อยส่ง snapshot ที่ข้อมูลหายเกือบหมด
local.getText('content').insert(readText(local).length, ' หมายเหตุ')
await call('POST', `/pages/${page.id}/ydoc/update`, {
  ...ctx, binary: Y.encodeStateAsUpdate(local),
})
const head3 = Number((await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true }))
  .headers['x-doc-head-seq'])

const shrunk = await call('POST', `/pages/${page.id}/ydoc/snapshot?upToSeq=${head3}`, {
  ...ctx, binary: lossySnapshot,
})
check('snapshot ที่เล็กลงผิดปกติยังรับไว้ (การลบเนื้อหาจำนวนมากก็เกิดขึ้นจริง)',
  shrunk.status === 200, `ได้ ${shrunk.status}`)
check('แต่ต้องไม่ prune — เก็บ update ไว้ให้กู้ได้',
  shrunk.body?.data?.pruneSkipped === true && shrunk.body?.data?.prunedUpdates === 0,
  JSON.stringify(shrunk.body?.data))

const survived = await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true })
const survivedText = readText(rebuild(parseFrames(survived.bytes)))
// ⚠️ นี่คือข้อที่จับบั๊กของดีไซน์เดิมได้
//    "เก็บไว้แต่ไม่ prune" อย่างเดียวไม่พอ เพราะ bootstrap หยิบ snapshot ที่
//    up_to_seq สูงสุดมาเสิร์ฟ ข้อมูลจึงยังอยู่ในฐานแต่ผู้ใช้เห็นหน้าว่าง
check('เนื้อหาเดิมยังเสิร์ฟได้ตามปกติ — snapshot ที่ยังไม่เชื่อไม่ถูกใช้',
  survivedText.includes('สรุปการประชุม'),
  `ได้ "${survivedText.slice(0, 80)}"`)

// ─── พยาน: snapshot ตัวที่สองที่ขนาดใกล้กันทำให้เชื่อได้ ────────────────────
//     ถ้าไม่มีกลไกนี้ หน้าที่ผู้ใช้ลบเนื้อหาจริงจะ compact ไม่ได้ตลอดไป
const witnessDoc = new Y.Doc()
witnessDoc.getText('content').insert(0, 'ก')
await call('POST', `/pages/${page.id}/ydoc/update`, {
  ...ctx, binary: Y.encodeStateAsUpdate(witnessDoc),
})
const head4 = Number((await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true }))
  .headers['x-doc-head-seq'])

const confirmed = await call('POST', `/pages/${page.id}/ydoc/snapshot?upToSeq=${head4}`, {
  ...ctx, binary: lossySnapshot,
})
check('snapshot ที่หดตัวตัวที่สองได้รับการยืนยันแล้ว prune ได้',
  confirmed.status === 200 && confirmed.body?.data?.pruneSkipped === false,
  JSON.stringify(confirmed.body?.data))

const emptySnap = await call("POST", `/pages/${page.id}/ydoc/snapshot?upToSeq=${head4}`, {
  ...ctx, binary: new Uint8Array(0),
})
check('snapshot ว่างเปล่า → 400', emptySnap.status === 400, `ได้ ${emptySnap.status}`)

// ═══════════════════════════════════════════════════════════════════════════
section('projection สำหรับ sidebar และค้นหา')
// ═══════════════════════════════════════════════════════════════════════════
const projected = await call('POST', `/pages/${page.id}/projection`, {
  ...ctx,
  body: { title: 'บันทึกการประชุม ครั้งที่ ๓', plainText: readText(local) },
})
check('ส่ง projection ได้', projected.status === 200, `ได้ ${projected.status}`)

const tree = (await call('GET', '/pages', ctx)).body.data
const node = tree.find((n) => n.id === page.id)
check('title ใน sidebar อัปเดตตาม projection',
  node?.title === 'บันทึกการประชุม ครั้งที่ ๓', node?.title)

// ═══════════════════════════════════════════════════════════════════════════
section('⚠️ tenant isolation ของเนื้อหา')
// ═══════════════════════════════════════════════════════════════════════════
// จับสถานะไว้ก่อน แล้วเทียบว่าคนนอกเปลี่ยนอะไรไม่ได้เลย
// (เทียบกับข้อความ "ต้นฉบับ" ไม่ได้ เพราะเทสด้านบนยืนยัน snapshot ที่หดตัวไป
//  แล้วโดยเจตนา — เนื้อหาจึงเปลี่ยนไปอย่างถูกต้อง)
const beforeIntrusion = readText(rebuild(parseFrames(
  (await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true })).bytes)))

const outsider = (await call('POST', '/auth/register', {
  body: {
    email: `คนนอกเอกสาร.${stamp}@ทดสอบ.local`,
    password: 'รหัสผ่านยาวพอสมควรนะครับ',
    name: 'คนนอก',
  },
})).body.data
const outsiderWs = (await call('POST', '/workspaces', {
  token: outsider.accessToken, body: { name: 'ที่อื่น' },
})).body.data
const outCtx = { token: outsider.accessToken, workspaceId: outsiderWs.id }

const stolenRead = await call('GET', `/pages/${page.id}/ydoc`, { ...outCtx, raw: true })
check('คนนอกอ่านเนื้อหาหน้าของ workspace อื่นไม่ได้ → 404', stolenRead.status === 404,
  `ได้ ${stolenRead.status}`)

const stolenWrite = await call('POST', `/pages/${page.id}/ydoc/update`, {
  ...outCtx, binary: Y.encodeStateAsUpdate(lossy),
})
check('คนนอกเขียนทับเนื้อหาไม่ได้ → 404', stolenWrite.status === 404, `ได้ ${stolenWrite.status}`)

const stolenSnapshot = await call('POST', `/pages/${page.id}/ydoc/snapshot?upToSeq=1`, {
  ...outCtx, binary: lossySnapshot,
})
check('คนนอกส่ง snapshot มาทับไม่ได้ → 404', stolenSnapshot.status === 404,
  `ได้ ${stolenSnapshot.status}`)

const stillThere = await call('GET', `/pages/${page.id}/ydoc`, { ...ctx, raw: true })
const afterIntrusion = readText(rebuild(parseFrames(stillThere.bytes)))
check('เนื้อหาไม่ถูกแตะต้องเลยหลังคนนอกพยายามเขียนทั้งสามทาง',
  afterIntrusion === beforeIntrusion,
  `ก่อน "${beforeIntrusion.slice(0, 50)}" หลัง "${afterIntrusion.slice(0, 50)}"`)

// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️ รูปร่างที่แอปเก็บจริงคือ XmlFragment ไม่ใช่ Text
//
//  ทุกเคสข้างบนใช้ doc.getText('content') ซึ่งเป็น "คนละ root type" กับที่
//  PageEditor.tsx ใช้ (doc.getXmlFragment('blocknote')) แปลว่า pipeline ที่
//  พิสูจน์มาทั้งหมดพิสูจน์แค่ Y.Text แบน ๆ — commutativity/idempotence ของ
//  Yjs ไม่ขึ้นกับชนิดก็จริง แต่ "การเก็บและเสิร์ฟรูปร่างที่แอปใช้จริง" ไม่เคยถูกตรวจ
//
//  เคสข้างล่างปิดช่องนั้น ส่วนการตรวจว่ารูปร่างตรงกับ schema ของ BlockNote
//  อยู่ใน verify-blocknote-append.mjs (ต้องใช้ schema จริงจึงแยกไฟล์)
// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${C.yellow}── รูปร่างจริงที่แอปใช้ (XmlFragment) ──${C.off}`)

const shapePage = (await call('POST', '/pages', {
  ...ctx, body: { parentId: null, title: 'หน้าทดสอบรูปร่าง XmlFragment' },
})).body?.data

const shapeDoc = new Y.Doc()
const shapeFragment = shapeDoc.getXmlFragment('blocknote')
const group = new Y.XmlElement('blockGroup')
const container = new Y.XmlElement('blockContainer')
container.setAttribute('id', 'ทดสอบ-0001')
const paragraph = new Y.XmlElement('paragraph')
const xmlText = new Y.XmlText()
xmlText.insert(0, 'ข้อความไทยในรูปร่างจริงของ BlockNote')
paragraph.insert(0, [xmlText])
container.insert(0, [paragraph])
group.insert(0, [container])
shapeFragment.insert(0, [group])

const shapeUpdate = Y.encodeStateAsUpdate(shapeDoc)
const sent = await call('POST', `/pages/${shapePage.id}/ydoc/update`, {
  ...ctx, binary: shapeUpdate,
})
check('ส่ง update ที่เป็น XmlFragment ขึ้นเซิร์ฟเวอร์ได้', sent.status === 200,
  `ได้ ${sent.status}`)

const shapeBack = await call('GET', `/pages/${shapePage.id}/ydoc`, { ...ctx, raw: true })
const restored = rebuild(parseFrames(shapeBack.bytes))
const restoredFragment = restored.getXmlFragment('blocknote')

check('ประกอบกลับมาแล้วยังเป็น blockGroup เดียวที่ระดับบนสุด',
  restoredFragment.length === 1
  && restoredFragment.get(0)?.nodeName?.toLowerCase() === 'blockgroup',
  `length=${restoredFragment.length} first=${restoredFragment.get(0)?.nodeName}`)

check('ข้อความไทยในรูปร่าง XmlFragment กลับมาครบทุกไบต์',
  restoredFragment.toString().includes('ข้อความไทยในรูปร่างจริงของ BlockNote'),
  restoredFragment.toString().slice(0, 160))

check('attribute id ของ blockContainer ไม่หาย',
  restoredFragment.toString().includes('ทดสอบ-0001'),
  restoredFragment.toString().slice(0, 160))

console.log(`\nผ่าน ${C.green}${passed}${C.off} / ไม่ผ่าน ${failed > 0 ? C.red : C.dim}${failed}${C.off}\n`)
process.exit(failed > 0 ? 1 : 0)
