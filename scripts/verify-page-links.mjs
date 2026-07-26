#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  พิสูจน์ page_links และแผง backlinks
//
//      node scripts/verify-page-links.mjs [baseUrl]
//
//  สิ่งที่ต้องพิสูจน์ไม่ใช่ "เขียนลิงก์ได้" แต่เป็น:
//    1. ลิงก์ข้าม workspace เขียนลงฐานไม่ได้ (composite FK เป็นคนปฏิเสธ)
//    2. backlinks ไม่รั่วชื่อหน้าที่ผู้ใช้ไม่มีสิทธิ์เห็น
//    3. null ≠ [] — client เก่าที่ไม่ส่ง links[] ต้องไม่ทำให้ลิงก์เดิมหาย
//    4. mention หน้าที่เพิ่งถูกลบ ต้องไม่ทำให้ projection ทั้งหน้าพัง
//
//  ต้องมี API รันอยู่:  dotnet run --project api
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5081/api/v1'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

let passed = 0
let failed = 0

function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`  ${C.green}✓${C.off} ${label}`) }
  else { failed++; console.log(`  ${C.red}✗${C.off} ${label}${detail ? `\n      ${C.dim}${detail}${C.off}` : ''}`) }
}

/** รัน SQL กับฐานเดียวกับที่ API ใช้ (ดู scripts/run-sql.cs) */
function sql(text) {
  try {
    return { ok: true, out: execFileSync('dotnet', ['run', 'scripts/run-sql.cs', '-', '--quiet'],
      { encoding: 'utf8', cwd: ROOT, input: text }).trim() }
  } catch (cause) {
    return { ok: false, out: (cause.stderr ?? '') + (cause.stdout ?? '') }
  }
}

async function api(path, { method = 'GET', body, token, workspaceId } = {}) {
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

const stamp = String(Date.now() % 1_000_000)
const pass = 'รหัสผ่านยาวพอสมควรนะครับ'

async function makeUser(prefix, name) {
  const account = { email: `${prefix}.${stamp}@ทดสอบ.local`, password: pass, name }
  const r = await api('/auth/register', { method: 'POST', body: account })
  return { ...account, token: r.body?.data?.accessToken, userId: r.body?.data?.user?.id }
}

console.log(`${C.yellow}═══ ตรวจ page_links และ backlinks ═══${C.off}\n`)

// ─── เตรียมข้อมูล ────────────────────────────────────────────────────────
console.log(`${C.yellow}── เตรียมข้อมูล ──${C.off}`)

const alice = await makeUser('อลิส', 'อลิส เจ้าของ')
const bob = await makeUser('บ๊อบ', 'บ๊อบ คนนอก')
check('สมัครสองบัญชี', alice.token !== undefined && bob.token !== undefined)

const wsA = await api('/workspaces', { method: 'POST', body: { name: `ลิงก์ A ${stamp}` }, token: alice.token })
const wsB = await api('/workspaces', { method: 'POST', body: { name: `ลิงก์ B ${stamp}` }, token: bob.token })
const A = wsA.body?.data?.id
const B = wsB.body?.data?.id
check('สร้าง workspace คนละอัน', A !== undefined && B !== undefined)

const asAlice = { token: alice.token, workspaceId: A }
const asBob = { token: bob.token, workspaceId: B }

async function newPage(auth, title, parentId = null) {
  const r = await api('/pages', { method: 'POST', body: { parentId, title }, ...auth })
  return r.body?.data?.id
}

const hub = await newPage(asAlice, 'หน้าสารบัญ')
const one = await newPage(asAlice, 'บันทึกที่หนึ่ง')
const two = await newPage(asAlice, 'บันทึกที่สอง')
const outsider = await newPage(asBob, 'หน้าของบ๊อบ')
check('สร้างหน้าครบ', [hub, one, two, outsider].every((id) => id !== undefined))

// ─── เขียนลิงก์ผ่าน projection ───────────────────────────────────────────
console.log(`\n${C.yellow}── เขียนลิงก์ผ่าน projection ──${C.off}`)

const wrote = await api(`/pages/${one}/projection`, {
  method: 'POST',
  body: { title: 'บันทึกที่หนึ่ง', plainText: 'อ้างถึงสารบัญและบันทึกที่สอง', links: [hub, two] },
  ...asAlice,
})
check('projection ที่มี links[] สำเร็จ', wrote.status === 200, JSON.stringify(wrote.body))

const rows = sql(`SELECT count(*) FROM page_links WHERE source_page_id = '${one}'`)
check('มีสองแถวในฐาน', rows.ok, rows.out)

const backlinks = await api(`/pages/${hub}/backlinks`, asAlice)
check('backlinks ของสารบัญเห็นบันทึกที่หนึ่ง',
  backlinks.status === 200 && backlinks.body?.data?.some((b) => b.id === one),
  JSON.stringify(backlinks.body))

// ─── replace-all ─────────────────────────────────────────────────────────
console.log(`\n${C.yellow}── ความหมายของ null กับ [] ──${C.off}`)

const noLinksField = await api(`/pages/${one}/projection`, {
  method: 'POST',
  body: { title: 'บันทึกที่หนึ่ง', plainText: 'แก้ข้อความแต่ไม่ส่ง links' },
  ...asAlice,
})
const stillThere = await api(`/pages/${hub}/backlinks`, asAlice)
check('ไม่ส่ง links เลย → ลิงก์เดิมยังอยู่ (client เก่าต้องไม่ล้างข้อมูล)',
  noLinksField.status === 200 && stillThere.body?.data?.some((b) => b.id === one),
  JSON.stringify(stillThere.body))

await api(`/pages/${one}/projection`, {
  method: 'POST',
  body: { title: 'บันทึกที่หนึ่ง', plainText: 'ลบลิงก์ทั้งหมด', links: [] },
  ...asAlice,
})
const cleared = await api(`/pages/${hub}/backlinks`, asAlice)
check('ส่ง links: [] → ลิงก์หายหมด', cleared.body?.data?.length === 0, JSON.stringify(cleared.body))

// ─── ขอบเขต workspace ────────────────────────────────────────────────────
console.log(`\n${C.yellow}── ขอบเขต workspace ──${C.off}`)

const crossTenant = await api(`/pages/${one}/projection`, {
  method: 'POST',
  body: { title: 'ลองลิงก์ข้ามบ้าน', plainText: 'x', links: [outsider] },
  ...asAlice,
})
const afterCross = sql(
  `SELECT count(*) FROM page_links WHERE source_page_id = '${one}' AND target_page_id = '${outsider}'`)
check('ลิงก์ไปหน้าของ workspace อื่น → ถูกทิ้งเงียบ ๆ ไม่ error',
  crossTenant.status === 200, JSON.stringify(crossTenant.body))
check('และไม่มีแถวนั้นในฐานจริง', afterCross.ok, afterCross.out)

// ⚠️ นี่คือเคสที่สำคัญที่สุด — พิสูจน์ว่า composite FK เป็นคนกัน ไม่ใช่โค้ด C#
const forced = sql(`
  INSERT INTO page_links (workspace_id, source_page_id, target_page_id)
  VALUES ('${A}', '${one}', '${outsider}')
`)
check('ยัด SQL ตรง ๆ ให้ลิงก์ข้าม workspace → ฐานปฏิเสธเอง (composite FK)',
  !forced.ok && /foreign key|23503/i.test(forced.out),
  forced.ok ? 'ฐานยอมรับ! composite FK ไม่ทำงาน' : forced.out.split('\n')[0])

const selfLink = sql(`
  INSERT INTO page_links (workspace_id, source_page_id, target_page_id)
  VALUES ('${A}', '${one}', '${one}')
`)
check('ลิงก์ตัวเอง → CHECK ปฏิเสธ',
  !selfLink.ok && /ck_page_links_no_self|23514/i.test(selfLink.out),
  selfLink.ok ? 'ฐานยอมรับ!' : selfLink.out.split('\n')[0])

// ─── backlinks ไม่รั่วชื่อหน้าที่ไม่มีสิทธิ์เห็น ──────────────────────────
console.log(`\n${C.yellow}── backlinks ไม่รั่วข้อมูล ──${C.off}`)

const outsiderBacklinks = await api(`/pages/${hub}/backlinks`, asBob)
check('คนนอก workspace ขอ backlinks → 404 ไม่ใช่ 403 (ไม่บอกว่าหน้ามีอยู่)',
  outsiderBacklinks.status === 404, `ได้ ${outsiderBacklinks.status}`)

// ─── ลบหน้าแล้วลิงก์ต้องหายทั้งสองทาง ────────────────────────────────────
console.log(`\n${C.yellow}── ลบหน้าแล้ว edge ต้องไม่ห้อย ──${C.off}`)

await api(`/pages/${one}/projection`, {
  method: 'POST', body: { title: 'กลับมาลิงก์อีกครั้ง', plainText: 'x', links: [hub, two] }, ...asAlice,
})

// ลบหน้าปลายทาง — เคสที่พังถ้า FK ฝั่ง target เป็น NoAction
const deletedTarget = await api(`/pages/${two}`, { method: 'DELETE', ...asAlice })
check('ลบหน้า "ปลายทาง" ที่มีคนลิงก์มาได้ (soft delete)',
  deletedTarget.status === 200, JSON.stringify(deletedTarget.body))

const purged = await api(`/pages/${two}/purge`, { method: 'DELETE', ...asAlice })
check('purge หน้าปลายทางได้ — FK ฝั่ง target ต้อง cascade ไม่ใช่ NoAction',
  purged.status === 200, JSON.stringify(purged.body))

const afterPurge = sql(
  `SELECT count(*) FROM page_links WHERE target_page_id = '${two}'`)
check('แถวที่ชี้ไปหน้าที่ถูก purge หายเอง', afterPurge.ok, afterPurge.out)

// ─── mention หน้าที่ถูกลบ ต้องไม่ทำให้ projection พัง ────────────────────
console.log(`\n${C.yellow}── ทนต่อ mention ที่ตายแล้ว ──${C.off}`)

const afterDeadMention = await api(`/pages/${one}/projection`, {
  method: 'POST',
  body: { title: 'ยังพิมพ์ได้อยู่', plainText: 'อ้างถึงหน้าที่ถูกลบไปแล้ว', links: [two, hub] },
  ...asAlice,
})
check('projection ที่ mention หน้าที่ถูกลบ → ยังสำเร็จ ไม่ 500',
  afterDeadMention.status === 200, JSON.stringify(afterDeadMention.body))

const pageAfter = await api(`/pages/${one}`, asAlice)
check('และ title ยังถูกอัปเดต (ลิงก์เสียต้องไม่ทำให้ sidebar พัง)',
  pageAfter.body?.data?.title === 'ยังพิมพ์ได้อยู่',
  JSON.stringify(pageAfter.body?.data?.title))

// ─── CHECK ที่บีบแล้ว ────────────────────────────────────────────────────
console.log(`\n${C.yellow}── page_acls ไม่รับ 'group' อีกแล้ว ──${C.off}`)

const groupAcl = sql(`
  INSERT INTO page_acls (page_id, workspace_id, subject_type, subject_id, role, granted_at)
  VALUES ('${hub}', '${A}', 'group', '${alice.userId}', 'editor', now())
`)
check("subject_type = 'group' → ฐานปฏิเสธ (constraint ที่เคยโกหกถูกบีบแล้ว)",
  !groupAcl.ok && /ck_page_acls_subject_type|23514/i.test(groupAcl.out),
  groupAcl.ok ? 'ฐานยอมรับ!' : groupAcl.out.split('\n')[0])

console.log(`\nผ่าน ${C.green}${passed}${C.off} / ไม่ผ่าน ${failed > 0 ? C.red : C.dim}${failed}${C.off}\n`)
process.exit(failed > 0 ? 1 : 0)
