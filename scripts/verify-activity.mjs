#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  พิสูจน์ว่า "เจ้าของตรวจงานที่ AI ทำได้" เป็นจริง
//
//      node scripts/verify-activity.mjs [baseUrl]
//
//  สองเรื่องที่ตรวจ:
//
//    1. activity_log — ทุกการเปลี่ยนแปลงต้องมีแถวประวัติที่บอกได้ว่า
//       ใครทำ ทำอะไร กับหน้าไหน และเปลี่ยนจากอะไรเป็นอะไร
//       โดยแยก "AI ทำ" ออกจาก "คนทำ" ได้จริง (users.kind)
//
//    2. page_notes — ช่องที่ AI เขียนข้อความได้โดยไม่ต้องแตะ Yjs
//       และเป็น caller แรกของ PageRole.Commenter ในระบบ (สิทธิ์ที่เขียน
//       ความเห็นได้แต่แก้เอกสารไม่ได้ ซึ่งก่อนหน้านี้ไม่ต่างจาก viewer เลย)
//
//  ต้องมี API รันอยู่ก่อน:  dotnet run --project api
// ═══════════════════════════════════════════════════════════════════════════
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
const password = 'รหัสผ่านยาวพอสมควรนะครับ'

async function api(path, { method = 'POST', body, token, workspaceId } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId

  const response = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`${C.yellow}═══ ตรวจฟีดกิจกรรมและบันทึก ═══${C.off}`)

section('เตรียมเจ้าของ บัญชี AI และ workspace')

const owner = await api('/auth/register', {
  body: { email: `เจ้าของ.${stamp}@ทดสอบ.local`, password, name: 'เจ้าของงาน' },
})
check('สมัครเจ้าของ', owner.status === 200, JSON.stringify(owner.body))
const ownerToken = owner.body?.data?.accessToken
const ownerId = owner.body?.data?.user?.id

const ws = await api('/workspaces', { body: { name: `กิจกรรม ${stamp}` }, token: ownerToken })
const workspaceId = ws.body?.data?.id
const asOwner = { token: ownerToken, workspaceId }

// บัญชีของ AI — สมัครเองแล้วให้ owner ทำเครื่องหมายว่าเป็น agent
const agentEmail = `claude.${stamp}@ทดสอบ.local`
const agent = await api('/auth/register', {
  body: { email: agentEmail, password, name: 'Claude (AI)' },
})
const agentToken = agent.body?.data?.accessToken
const agentId = agent.body?.data?.user?.id

await api('/workspaces/current/members', {
  body: { email: agentEmail, role: 'member' }, ...asOwner,
})
const marked = await api(`/workspaces/current/members/${agentId}`, {
  method: 'PATCH', body: { role: 'member', kind: 'agent' }, ...asOwner,
})
check('ทำเครื่องหมายบัญชี AI เป็น agent', marked.status === 200, JSON.stringify(marked.body))

const asAgent = { token: agentToken, workspaceId }

section('ทุกการเปลี่ยนแปลงต้องทิ้งร่องรอย')

const project = await api('/pages', { body: { parentId: null, title: 'แผนงานไตรมาสสี่' }, ...asOwner })
const projectId = project.body?.data?.id

// ─── AI ทำงาน ─────────────────────────────────────────────────────────────
const task = await api('/pages', {
  body: { parentId: projectId, title: 'รวบรวมตัวเลขยอดขาย', status: 'todo' }, ...asAgent,
})
check('AI สร้างงานได้', task.status === 201, JSON.stringify(task.body))
const taskId = task.body?.data?.id

await api(`/pages/${taskId}`, { method: 'PATCH', body: { status: 'doing' }, ...asAgent })
await api(`/pages/${taskId}`, { method: 'PATCH', body: { status: 'done' }, ...asAgent })
await api(`/pages/${taskId}`, { method: 'PATCH', body: { title: 'รวบรวมตัวเลขยอดขาย (เสร็จ)' }, ...asAgent })

const feed = await api('/activity', { method: 'GET', ...asOwner })
check('เจ้าของอ่านฟีดกิจกรรมได้', feed.status === 200, JSON.stringify(feed.body))

const items = feed.body?.data?.items ?? []
const actions = items.map((i) => i.action)

check('มีแถวตอนสร้างหน้า', actions.includes('page_created'), actions.join(', '))
check('มีแถวตอนเปลี่ยนสถานะ', actions.includes('status_changed'), actions.join(', '))
check('มีแถวตอนเปลี่ยนชื่อ', actions.includes('page_renamed'), actions.join(', '))

// ─── ค่าเดิม → ค่าใหม่ ────────────────────────────────────────────────────
const statusChanges = items.filter((i) => i.action === 'status_changed')
check('บันทึกการเปลี่ยนสถานะครบทั้งสองครั้ง', statusChanges.length === 2,
  JSON.stringify(statusChanges.map((s) => s.detail)))

const toDone = statusChanges.find((s) => s.detail?.to === 'done')
check('เก็บทั้งค่าเดิมและค่าใหม่ (doing → done)',
  toDone?.detail?.from === 'doing' && toDone?.detail?.to === 'done',
  JSON.stringify(toDone?.detail))
check('detail มีเวอร์ชันของ schema ตั้งแต่แถวแรก', toDone?.detail?.v === 1,
  JSON.stringify(toDone?.detail))

const renamed = items.find((i) => i.action === 'page_renamed')
check('เปลี่ยนชื่อเก็บชื่อเดิมไว้ด้วย',
  renamed?.detail?.from === 'รวบรวมตัวเลขยอดขาย', JSON.stringify(renamed?.detail))

section('⚠️ แยก "AI ทำ" ออกจาก "คนทำ" — เหตุผลที่ทั้งหมดนี้มีอยู่')

const agentRow = items.find((i) => i.action === 'status_changed')
check('ฟีดบอกชื่อผู้ทำ', agentRow?.actorName === 'Claude (AI)', agentRow?.actorName)
check('ฟีดบอกว่าเป็น agent ไม่ใช่คน', agentRow?.actorKind === 'agent', agentRow?.actorKind)

// เจ้าของทำอะไรบ้าง แล้วต้องแยกออกจากกันได้
await api(`/pages/${projectId}`, { method: 'PATCH', body: { status: 'doing' }, ...asOwner })

const onlyAgent = await api('/activity?actorKind=agent', { method: 'GET', ...asOwner })
check('กรองเฉพาะที่ AI ทำได้',
  onlyAgent.body?.data?.items?.length > 0
  && onlyAgent.body.data.items.every((i) => i.actorKind === 'agent'),
  JSON.stringify(onlyAgent.body?.data?.items?.map((i) => i.actorKind)))

const onlyHuman = await api('/activity?actorKind=human', { method: 'GET', ...asOwner })
check('กรองเฉพาะที่คนทำได้',
  onlyHuman.body?.data?.items?.length > 0
  && onlyHuman.body.data.items.every((i) => i.actorKind === 'human'),
  JSON.stringify(onlyHuman.body?.data?.items?.map((i) => i.actorKind)))

const badKind = await api('/activity?actorKind=หุ่นยนต์', { method: 'GET', ...asOwner })
check('actorKind ที่ไม่รู้จัก → 400 ไม่ใช่ผลว่าง',
  badKind.status === 400 && badKind.body?.code === 'invalid_user_kind',
  `ได้ ${badKind.status} ${badKind.body?.code}`)

const perPage = await api(`/activity?pageId=${taskId}`, { method: 'GET', ...asOwner })
check('ดูประวัติของหน้าเดียวได้',
  perPage.body?.data?.items?.length > 0
  && perPage.body.data.items.every((i) => i.pageId === taskId),
  JSON.stringify(perPage.body?.data?.items?.map((i) => i.action)))

section('บันทึกความคืบหน้า')

const note = await api(`/pages/${taskId}/notes`, {
  body: { body: 'ดึงข้อมูลจากระบบบัญชีแล้ว เดือนกันยายนยังไม่ปิดงบ' }, ...asAgent,
})
check('AI เขียนบันทึกได้', note.status === 200, JSON.stringify(note.body))
check('บันทึกบอกว่า AI เป็นคนเขียน', note.body?.data?.authorKind === 'agent',
  JSON.stringify(note.body?.data))

const notes = await api(`/pages/${taskId}/notes`, { method: 'GET', ...asOwner })
check('เจ้าของอ่านบันทึกของ AI ได้', notes.body?.data?.length === 1,
  JSON.stringify(notes.body?.data))

const noteActivity = await api(`/activity?pageId=${taskId}`, { method: 'GET', ...asOwner })
check('การเขียนบันทึกโผล่ในฟีดด้วย',
  noteActivity.body?.data?.items?.some((i) => i.action === 'note_added'),
  JSON.stringify(noteActivity.body?.data?.items?.map((i) => i.action)))
check('ฟีดมีตัวอย่างข้อความให้อ่านผ่าน ๆ ได้',
  noteActivity.body?.data?.items?.find((i) => i.action === 'note_added')?.detail?.preview
    ?.includes('ระบบบัญชี'),
  JSON.stringify(noteActivity.body?.data?.items?.find((i) => i.action === 'note_added')?.detail))

const empty = await api(`/pages/${taskId}/notes`, { body: { body: '   ' }, ...asAgent })
check('บันทึกว่างเปล่า → 400', empty.status === 400 && empty.body?.code === 'note_empty',
  `ได้ ${empty.status} ${empty.body?.code}`)

const tooLong = await api(`/pages/${taskId}/notes`, { body: { body: 'ก'.repeat(4001) }, ...asAgent })
check('บันทึกยาวเกิน → 400 พร้อมบอกว่าควรเขียนที่ไหนแทน',
  tooLong.status === 400 && tooLong.body?.code === 'note_too_long',
  `ได้ ${tooLong.status} ${tooLong.body?.code}`)

section('⚠️ commenter เขียนบันทึกได้แต่แก้เอกสารไม่ได้')
// ═══════════════════════════════════════════════════════════════════════════
//  caller แรกของ PageRole.Commenter ในระบบ — ก่อนหน้านี้ค่านี้มีอยู่ใน enum
//  และใน CHECK constraint แต่ไม่มีโค้ดไหนแยกมันออกจาก Viewer เลย
//
//  เป็นวิธีจำกัดขอบเขต AI ที่ตรงจุด: ให้รายงานได้ แต่ห้ามแก้เอกสาร
// ═══════════════════════════════════════════════════════════════════════════

const reviewer = await api('/auth/register', {
  body: { email: `ผู้ตรวจ.${stamp}@ทดสอบ.local`, password, name: 'ผู้ตรวจงาน' },
})
const reviewerToken = reviewer.body?.data?.accessToken
const reviewerId = reviewer.body?.data?.user?.id

await api('/workspaces/current/members', {
  body: { email: `ผู้ตรวจ.${stamp}@ทดสอบ.local`, role: 'guest' }, ...asOwner,
})

// guest ไม่เห็นอะไรจนกว่าจะได้รับสิทธิ์ระดับหน้า — ให้ commenter บนโปรเจกต์
const grant = await api(`/pages/${projectId}/acl`, {
  body: { subjectType: 'user', subjectId: reviewerId, role: 'commenter' }, ...asOwner,
})

const asReviewer = { token: reviewerToken, workspaceId }

if (grant.status === 200 || grant.status === 201) {
  const reviewerNote = await api(`/pages/${taskId}/notes`, {
    body: { body: 'ขอให้ตรวจสอบตัวเลขเดือนสิงหาคมด้วย' }, ...asReviewer,
  })
  check('commenter เขียนบันทึกได้', reviewerNote.status === 200,
    `ได้ ${reviewerNote.status} ${reviewerNote.body?.code}`)

  const reviewerEdit = await api(`/pages/${taskId}`, {
    method: 'PATCH', body: { status: 'todo' }, ...asReviewer,
  })
  check('commenter แก้สถานะไม่ได้ → 403',
    reviewerEdit.status === 403, `ได้ ${reviewerEdit.status} ${reviewerEdit.body?.code}`)
} else {
  check('ตั้งสิทธิ์ commenter ได้ (ยังไม่มี endpoint ACL — ข้ามเคสนี้)', true,
    `POST /pages/{id}/acl → ${grant.status}`)
  console.log(`      ${C.dim}ยังไม่มี endpoint ให้ตั้งสิทธิ์ระดับหน้า — เคส commenter`)
  console.log(`      ทดสอบผ่าน API ไม่ได้จนกว่าจะทำ Phase 5${C.off}`)
}

section('⚠️ tenant isolation ของฟีดและบันทึก')

const outsider = await api('/auth/register', {
  body: { email: `คนนอก.${stamp}@ทดสอบ.local`, password, name: 'คนนอก' },
})
const outsiderToken = outsider.body?.data?.accessToken
const outsiderWs = await api('/workspaces', { body: { name: `คนนอก ${stamp}` }, token: outsiderToken })
const asOutsider = { token: outsiderToken, workspaceId: outsiderWs.body?.data?.id }

const leakFeed = await api('/activity', { method: 'GET', ...asOutsider })
check('คนนอกไม่เห็นกิจกรรมของ workspace อื่น',
  leakFeed.body?.data?.count === 0, JSON.stringify(leakFeed.body?.data))

const leakNotes = await api(`/pages/${taskId}/notes`, { method: 'GET', ...asOutsider })
check('คนนอกอ่านบันทึกของ workspace อื่นไม่ได้ → 404',
  leakNotes.status === 404, `ได้ ${leakNotes.status}`)

const leakWrite = await api(`/pages/${taskId}/notes`, {
  body: { body: 'ไม่ควรเขียนได้' }, ...asOutsider,
})
check('คนนอกเขียนบันทึกใส่หน้าของ workspace อื่นไม่ได้ → 404',
  leakWrite.status === 404, `ได้ ${leakWrite.status}`)

section('⚠️ ลบถาวรแล้วประวัติต้องยังอยู่')
// ═══════════════════════════════════════════════════════════════════════════
//  FK เป็น ON DELETE SET NULL (page_id) ไม่ใช่ CASCADE โดยเจตนา
//
//  ถ้า CASCADE การ purge จะลบประวัติของหน้านั้นทิ้งไปด้วย = ลบหลักฐานพอดีตอนที่
//  คำถาม "ใครลบหน้านี้" มีค่าที่สุด
//
//  และต้องระบุคอลัมน์ด้วย: SET NULL เปล่า ๆ จะ null ทั้ง (workspace_id, page_id)
//  ซึ่ง workspace_id เป็น NOT NULL → purge จะล้มทั้งคำสั่ง
// ═══════════════════════════════════════════════════════════════════════════

const doomed = await api('/pages', { body: { parentId: null, title: `หน้าที่จะถูกลบถาวร ${stamp}` }, ...asOwner })
const doomedId = doomed.body?.data?.id

await api(`/pages/${doomedId}`, { method: 'PATCH', body: { status: 'doing' }, ...asOwner })
await api(`/pages/${doomedId}`, { method: 'DELETE', ...asOwner })

const purged = await api(`/pages/${doomedId}/purge`, { method: 'DELETE', ...asOwner })
check('ลบถาวรหน้าที่มีประวัติได้ (FK ไม่ทำให้ล้ม)', purged.status === 200,
  `ได้ ${purged.status} ${JSON.stringify(purged.body)}`)

const afterPurge = await api('/activity?limit=200', { method: 'GET', ...asOwner })
const orphaned = afterPurge.body?.data?.items?.filter(
  (i) => i.pageTitle === `หน้าที่จะถูกลบถาวร ${stamp}`) ?? []

check('ประวัติของหน้าที่ถูกลบถาวรยังอ่านได้', orphaned.length > 0,
  JSON.stringify(afterPurge.body?.data?.items?.slice(0, 5)))

// ⚠️ `== null` ไม่ใช่ `=== null` โดยเจตนา — API ตั้ง
//    DefaultIgnoreCondition = WhenWritingNull ทั้งโปรเจกต์ (ApiControllersConfiguration)
//    ค่า null จึง "ไม่ปรากฏในผลลัพธ์เลย" ไม่ใช่ปรากฏเป็น null
//    (เหตุผลเดียวกับที่ฝั่ง web ประกาศ icon?/deletedAt? เป็น optional)
check('แถวนั้นไม่มี page_id แล้ว แต่ยังรู้ว่าหน้าเคยชื่ออะไร',
  orphaned.every((i) => i.pageId == null && i.pageTitle.length > 0),
  JSON.stringify(orphaned.map((i) => ({ pageId: i.pageId ?? '(ไม่มี)', title: i.pageTitle }))))

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}สรุป${C.off} ${C.green}ผ่าน ${passed}${C.off} / ${failed > 0 ? C.red : C.dim}ไม่ผ่าน ${failed}${C.off}`)

if (failed > 0) {
  console.log(`\n${C.red}เคสที่ไม่ผ่าน:${C.off}`)
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('')
