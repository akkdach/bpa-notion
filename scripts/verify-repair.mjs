#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  พิสูจน์ว่าเครื่องมือ "ตรวจ" และ "ซ่อม" ทำงานจริง
//
//      node scripts/verify-repair.mjs [baseUrl]
//
//  ancestor_ids กับ access_root_id เป็นค่า denormalise ที่เพี้ยนได้ และเมื่อ
//  access_root_id เพี้ยน มันคือบั๊กเรื่องสิทธิ์ ซึ่งเป็นบั๊กที่แย่ที่สุด
//
//  การมีปุ่มซ่อมที่ "ไม่เคยเห็นมันทำงาน" มีค่าเท่ากับไม่มี สคริปต์นี้จึงจงใจ
//  ทำข้อมูลให้เพี้ยนด้วย SQL ตรง ๆ แล้วตรวจว่า:
//    1. endpoint ตรวจความสอดคล้อง "จับได้"
//    2. endpoint ซ่อม "แก้ถูก"
//    3. ตรวจซ้ำแล้วสะอาด
//
//  ⚠️ ต้องรันกับฐานข้อมูล dev เท่านั้น — มันแก้ข้อมูลโดยตรง
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process'

const BASE = process.argv[2] ?? 'http://localhost:5081/api/v1'
const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

let passed = 0
let failed = 0

function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`  ${C.green}✓${C.off} ${label}`) }
  else { failed++; console.log(`  ${C.red}✗${C.off} ${label}${detail ? `\n      ${C.dim}${detail}${C.off}` : ''}`) }
}

/** รัน SQL ผ่าน docker compose exec — ไม่ต้องพึ่ง driver ฝั่ง Node */
function psql(sql) {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres',
     '-d', 'projectmanagement', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') },
  ).trim()
}

async function call(method, path, { body, token, workspaceId } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId

  const r = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

const stamp = String(Date.now() % 100000)

console.log(`${C.yellow}═══ ตรวจเครื่องมือซ่อม tree ═══${C.off}\n`)

// ─── เตรียมข้อมูล ────────────────────────────────────────────────────────
const account = {
  email: `ซ่อม.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'ผู้ทดสอบ ซ่อมทรี',
}
const auth = (await call('POST', '/auth/register', { body: account })).body.data
const token = auth.accessToken
const ws = (await call('POST', '/workspaces', {
  token, body: { name: 'ทดสอบการซ่อม' },
})).body.data
const ctx = { token, workspaceId: ws.id }

const mk = async (parentId, title) =>
  (await call('POST', '/pages', { ...ctx, body: { parentId, title } })).body.data

const a = await mk(null, 'แผนกบุคคล')
const b = await mk(a.id, 'สวัสดิการ')
const c = await mk(b.id, 'ประกันสุขภาพ')
const d = await mk(c.id, 'วงเงินคุ้มครอง')

console.log(`${C.dim}สร้าง tree ลึก 4 ชั้นใน workspace ${ws.slug}${C.off}\n`)

const before = await call('GET', '/pages/maintenance/consistency', ctx)
check('เริ่มต้นข้อมูลสะอาด',
  before.body.data.badAncestors === 0 && before.body.data.badAccessRoots === 0,
  JSON.stringify(before.body.data))

// ─── จงใจทำให้เพี้ยน ─────────────────────────────────────────────────────
console.log(`\n${C.yellow}── ทำข้อมูลให้เพี้ยนด้วย SQL ตรง ๆ ──${C.off}`)

// ⚠️ ต้อง UPDATE depth ไปพร้อมกัน เพราะมี CHECK constraint
//    depth = cardinality(ancestor_ids) คุมอยู่ — ตัว constraint เองก็คือ
//    เครื่องป้องกันชั้นแรกที่ทำให้ความเพี้ยนแบบง่าย ๆ เข้าฐานไม่ได้เลย
psql(`UPDATE pages SET ancestor_ids = ARRAY['${a.id}']::uuid[], depth = 1
       WHERE id = '${d.id}'`)
check('ancestor_ids ของหน้าลึกสุดถูกทำให้ผิด (ข้ามชั้นกลางไป)', true)

psql(`UPDATE pages SET access_root_id = '${d.id}' WHERE id = '${c.id}'`)
check('access_root_id ของอีกหน้าถูกทำให้ชี้ผิดที่', true)

// constraint ต้องกันความเพี้ยนที่ขัดกันเองไม่ให้เข้าฐานได้
let constraintHeld = false
try {
  psql(`UPDATE pages SET ancestor_ids = ARRAY['${a.id}','${b.id}']::uuid[], depth = 9
         WHERE id = '${c.id}'`)
} catch {
  constraintHeld = true
}
check('CHECK constraint กัน depth ที่ไม่ตรงกับ ancestor_ids ไม่ให้เข้าฐาน', constraintHeld,
  'ถ้าเข้าได้แปลว่า ck_pages_depth_matches_ancestors หายไป')

// ─── ตรวจต้องจับได้ ──────────────────────────────────────────────────────
console.log(`\n${C.yellow}── ตรวจ ──${C.off}`)
const detected = await call('GET', '/pages/maintenance/consistency', ctx)
check('ตรวจจับ ancestor_ids ที่เพี้ยนได้', detected.body.data.badAncestors > 0,
  `badAncestors = ${detected.body.data.badAncestors}`)
check('ตรวจจับ access_root_id ที่เพี้ยนได้', detected.body.data.badAccessRoots > 0,
  `badAccessRoots = ${detected.body.data.badAccessRoots}`)

// ─── ซ่อม ────────────────────────────────────────────────────────────────
console.log(`\n${C.yellow}── ซ่อม ──${C.off}`)
const repaired = await call('POST', '/pages/maintenance/repair', ctx)
check('ซ่อม ancestor_ids', repaired.body.data.fixedAncestors > 0,
  `fixedAncestors = ${repaired.body.data.fixedAncestors}`)
check('ซ่อม access_root_id', repaired.body.data.fixedAccessRoots > 0,
  `fixedAccessRoots = ${repaired.body.data.fixedAccessRoots}`)

const after = await call('GET', '/pages/maintenance/consistency', ctx)
check('ตรวจซ้ำแล้วสะอาด',
  after.body.data.badAncestors === 0 &&
  after.body.data.badAccessRoots === 0 &&
  after.body.data.orphans === 0,
  JSON.stringify(after.body.data))

// ─── ค่าที่ซ่อมแล้วต้องถูกต้องจริง ไม่ใช่แค่ "ไม่ขัดกันเอง" ─────────────────
const fixed = (await call('GET', `/pages/${d.id}`, ctx)).body.data
check('ancestor_ids ที่ซ่อมแล้วตรงกับโครงสร้างจริง',
  JSON.stringify(fixed.ancestorIds) === JSON.stringify([a.id, b.id, c.id]),
  `ได้ ${JSON.stringify(fixed.ancestorIds)}`)
check('depth ที่ซ่อมแล้วถูกต้อง', fixed.depth === 3, `ได้ ${fixed.depth}`)
check('access root กลับไปชี้ที่หน้าบนสุดของ tree', fixed.accessRootId === a.id,
  `ได้ ${fixed.accessRootId}`)

// ─── repair ต้อง idempotent ──────────────────────────────────────────────
const again = await call('POST', '/pages/maintenance/repair', ctx)
check('รันซ่อมซ้ำแล้วไม่แก้อะไรเพิ่ม (idempotent)',
  again.body.data.fixedAncestors === 0 && again.body.data.fixedAccessRoots === 0,
  JSON.stringify(again.body.data))

// ─── สิทธิ์ ──────────────────────────────────────────────────────────────
console.log(`\n${C.yellow}── สิทธิ์ของ endpoint ซ่อม ──${C.off}`)
const other = (await call('POST', '/auth/register', {
  body: { ...account, email: `คนอื่น.${stamp}@ทดสอบ.local`, name: 'คนอื่น' },
})).body.data
await call('POST', '/workspaces/current/members', {
  ...ctx, body: { email: `คนอื่น.${stamp}@ทดสอบ.local`, role: 'member' },
})
const memberRepair = await call('POST', '/pages/maintenance/repair', {
  token: other.accessToken, workspaceId: ws.id,
})
check('member เรียก repair ไม่ได้ → 403', memberRepair.status === 403,
  `ได้ ${memberRepair.status}`)

console.log(`\nผ่าน ${C.green}${passed}${C.off} / ไม่ผ่าน ${failed > 0 ? C.red : C.dim}${failed}${C.off}\n`)
process.exit(failed > 0 ? 1 : 0)
