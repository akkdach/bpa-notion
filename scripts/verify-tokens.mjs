#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  พิสูจน์ว่า API token ใช้ได้จริงและ "ผูกกับ workspace" ตามที่โฆษณา
//
//      node scripts/verify-tokens.mjs [baseUrl]
//
//  token คือสิ่งที่ลูกค้าเอาไปวางในเครื่องตัวเองเพื่อให้ Claude Code เข้ามา
//  ทำงานใน workspace ได้ คำสัญญาที่ผูกไว้กับมันมีสี่ข้อ และทุกข้อต้องตรวจได้:
//
//    1. ออกได้เฉพาะ owner/admin — ไม่ใช่ทุกคนที่แจกกุญแจได้
//    2. ใช้ได้กับ workspace ที่ออกให้เท่านั้น — เปลี่ยน header แล้วข้ามไม่ได้
//    3. เพิกถอนแล้วมีผล "ทันที" กับคำขอถัดไป ไม่ใช่รอ token หมดอายุ
//    4. เพิกถอนรายใบ — ใบอื่นของ workspace เดียวกันต้องไม่ได้รับผลกระทบ
//
//  ⚠️ และข้อที่ห้าซึ่งไม่ได้อยู่ในโฆษณาแต่พังได้เงียบที่สุด: การเพิ่ม
//     authentication scheme ที่สอง (AddPolicyScheme + ForwardDefaultSelector)
//     ทำให้ JWT ของเบราว์เซอร์พังทั้งระบบได้ — จึงมี section ที่ตรวจว่า
//     ทางเดิมยังใช้ได้อยู่ ไม่ใช่ตรวจแต่ทางใหม่
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

/**
 * @param apiToken  ค่า pmt_… — ส่งแทน JWT ใน Authorization header เดียวกัน
 *                  (เซิร์ฟเวอร์เลือก scheme จาก prefix ไม่ใช่จาก header คนละตัว)
 */
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
console.log(`${C.yellow}═══ ตรวจ API token ═══${C.off}`)

section('เตรียมเจ้าของ สมาชิก และ workspace สองอัน')

const owner = await api('/auth/register', {
  body: { email: `เจ้าของ.${stamp}@ทดสอบ.local`, password, name: 'เจ้าของงาน' },
})
check('สมัครเจ้าของ', owner.status === 200, JSON.stringify(owner.body))
const ownerToken = owner.body?.data?.accessToken

const wsA = await api('/workspaces', { body: { name: `กุญแจ ก ${stamp}` }, token: ownerToken })
const wsB = await api('/workspaces', { body: { name: `กุญแจ ข ${stamp}` }, token: ownerToken })
const idA = wsA.body?.data?.id
const idB = wsB.body?.data?.id
check('สร้าง workspace สองอัน', idA !== undefined && idB !== undefined && idA !== idB)

const asOwnerA = { token: ownerToken, workspaceId: idA }
const asOwnerB = { token: ownerToken, workspaceId: idB }

// สมาชิกธรรมดา — ไว้พิสูจน์ว่าไม่ใช่ทุกคนที่ออก token ได้
const memberEmail = `สมาชิก.${stamp}@ทดสอบ.local`
const member = await api('/auth/register', {
  body: { email: memberEmail, password, name: 'สมาชิกธรรมดา' },
})
const memberToken = member.body?.data?.accessToken
await api('/workspaces/current/members', {
  body: { email: memberEmail, role: 'member' }, ...asOwnerA,
})

section('ออก token ได้เฉพาะ owner/admin')

const byMember = await api('/workspaces/current/tokens', {
  body: { name: 'ของสมาชิก' }, token: memberToken, workspaceId: idA,
})
check('สมาชิกธรรมดาออก token ไม่ได้', byMember.status === 403, JSON.stringify(byMember.body))
check('  และบอกเหตุผลด้วยรหัส insufficient_role', byMember.body?.code === 'insufficient_role')

const listByMember = await api('/workspaces/current/tokens', {
  method: 'GET', token: memberToken, workspaceId: idA,
})
check('สมาชิกธรรมดาดูรายการ token ไม่ได้', listByMember.status === 403, JSON.stringify(listByMember.body))

section('ตรวจค่าที่รับไม่ได้ ก่อนจะออกใบจริง')

const noName = await api('/workspaces/current/tokens', { body: { name: '   ' }, ...asOwnerA })
check('ชื่อว่างถูกปฏิเสธ', noName.status === 400 && noName.body?.code === 'token_name_required',
  JSON.stringify(noName.body))

const longName = await api('/workspaces/current/tokens', {
  body: { name: 'ก'.repeat(101) }, ...asOwnerA,
})
check('ชื่อยาวเกินถูกปฏิเสธ', longName.status === 400 && longName.body?.code === 'token_name_too_long',
  JSON.stringify(longName.body))

const zeroDays = await api('/workspaces/current/tokens', {
  body: { name: 'อายุศูนย์วัน', expiresInDays: 0 }, ...asOwnerA,
})
check('อายุ 0 วันถูกปฏิเสธ', zeroDays.status === 400 && zeroDays.body?.code === 'invalid_expiry',
  JSON.stringify(zeroDays.body))

section('ออกใบจริง')

const created = await api('/workspaces/current/tokens', {
  body: { name: 'โน้ตบุ๊กสมชาย' }, ...asOwnerA,
})
check('ออก token สำเร็จ', created.status === 200, JSON.stringify(created.body))

const tokenA = created.body?.data?.token
check('ค่าจริงขึ้นต้นด้วย pmt_', typeof tokenA === 'string' && tokenA.startsWith('pmt_'), String(tokenA))

// ยาวพอที่จะเดาไม่ได้ — 32 ไบต์ base64url คือ 43 ตัวอักษร บวก prefix
check('ค่าจริงยาวพอ (≥ 40 ตัวอักษร)', (tokenA?.length ?? 0) >= 40, `ยาว ${tokenA?.length}`)
check('last4 ตรงกับสี่ตัวท้ายของค่าจริง', created.body?.data?.last4 === tokenA?.slice(-4),
  `${created.body?.data?.last4} vs ${tokenA?.slice(-4)}`)

const listed = await api('/workspaces/current/tokens', { method: 'GET', ...asOwnerA })
const row = listed.body?.data?.find((t) => t.id === created.body?.data?.id)
check('ใบใหม่โผล่ในรายการ', row !== undefined, JSON.stringify(listed.body))
check('  สถานะเป็น active', row?.status === 'active')

// ─────────────────────────────────────────────────────────────────────────
//  ข้อนี้คือหัวใจของ "เก็บแค่ hash"
//
//  ถ้าวันหนึ่งมีคนเพิ่ม Token เข้าไปใน ApiTokenDto เพื่อความสะดวก คำสัญญาว่า
//  "ค่าจริงแสดงครั้งเดียว" จะตายเงียบ ๆ โดยไม่มีอะไรฟ้อง — ข้อนี้ฟ้อง
// ─────────────────────────────────────────────────────────────────────────
check('รายการไม่ส่งค่าจริงกลับมาไม่ว่าในฟิลด์ใด',
  !JSON.stringify(listed.body).includes(tokenA), JSON.stringify(row))

check('ยังไม่เคยใช้ → ไม่มี lastUsedAt', row?.lastUsedAt === undefined, JSON.stringify(row))

section('บัญชี agent ถูกสร้างให้เองตอนออกใบแรก')

const membersA = await api('/workspaces/current/members', { method: 'GET', ...asOwnerA })
const agents = (membersA.body?.data ?? []).filter((m) => m.kind === 'agent')
check('มีบัญชี agent หนึ่งบัญชี', agents.length === 1, JSON.stringify(membersA.body?.data))

// ⚠️ ไม่ใช่ guest — guest สร้างหน้าระดับบนสุดไม่ได้ AI จะเจอ Forbidden แล้ว
//    ลองซ้ำไม่จบ (ดู PageTreeService.CreateAsync)
check('agent เป็น member ไม่ใช่ guest', agents[0]?.role === 'member', agents[0]?.role)

const second = await api('/workspaces/current/tokens', {
  body: { name: 'เครื่องที่สอง' }, ...asOwnerA,
})
check('ออกใบที่สองได้', second.status === 200, JSON.stringify(second.body))
const tokenA2 = second.body?.data?.token

const membersAgain = await api('/workspaces/current/members', { method: 'GET', ...asOwnerA })
check('ออกใบที่สองแล้วบัญชี agent ยังมีอันเดียว',
  (membersAgain.body?.data ?? []).filter((m) => m.kind === 'agent').length === 1)

section('ใช้ token ทำงานจริง')

// ไม่ส่ง X-Workspace-Id เลย — ขอบเขตต้องมาจากตัว token
const whoami = await api('/workspaces/current', { method: 'GET', token: tokenA })
check('เรียก /workspaces/current ได้โดยไม่ต้องส่ง X-Workspace-Id', whoami.status === 200,
  JSON.stringify(whoami.body))
check('  และได้ workspace ที่ออกใบให้', whoami.body?.data?.id === idA,
  `${whoami.body?.data?.id} vs ${idA}`)

const page = await api('/pages', {
  body: { parentId: null, title: `งานที่ AI สร้าง ${stamp}` }, token: tokenA,
})
// 201 ไม่ใช่ 200 — POST /pages คืน CreatedAtAction
check('สร้างหน้าระดับบนสุดด้วย token ได้', page.status === 201, JSON.stringify(page.body))
const pageId = page.body?.data?.id

// ─────────────────────────────────────────────────────────────────────────
//  การระบุตัวผู้ทำคือเหตุผลทั้งหมดที่ token ผูกกับบัญชี agent แยกต่างหาก
//  ถ้าข้อนี้ไม่ผ่าน แปลว่าเจ้าของแยก "งานที่ AI ทำ" ออกจาก "งานที่ฉันทำ" ไม่ได้
// ─────────────────────────────────────────────────────────────────────────
const activity = await api(`/activity?pageId=${pageId}`, { method: 'GET', ...asOwnerA })
const entry = activity.body?.data?.items?.[0]
check('กิจกรรมบันทึกว่าเป็นฝีมือ agent', entry?.actorKind === 'agent',
  JSON.stringify(entry))

section('ขอบเขต workspace — ข้ามไม่ได้')

const crossed = await api('/pages', {
  method: 'GET', token: tokenA, workspaceId: idB,
})
check('token ของ ก + header ชี้ไป ข → 403', crossed.status === 403, JSON.stringify(crossed.body))
check('  รหัส token_workspace_mismatch', crossed.body?.code === 'token_workspace_mismatch')

const matching = await api('/pages', { method: 'GET', token: tokenA, workspaceId: idA })
check('token ของ ก + header ชี้ไป ก → ผ่าน (header ที่ตรงกันไม่ถือว่าผิด)',
  matching.status === 200, JSON.stringify(matching.body))

const tokensOfB = await api('/workspaces/current/tokens', { method: 'GET', ...asOwnerB })
check('workspace ข ยังไม่มี token เลย (ใบของ ก ไม่รั่วข้ามมา)',
  Array.isArray(tokensOfB.body?.data) && tokensOfB.body.data.length === 0,
  JSON.stringify(tokensOfB.body))

section('ค่าที่ปลอมมาต้องไม่ผ่าน')

// ⚠️ ค่าทดสอบตรงนี้ต้องเป็น ASCII ล้วน แม้ทั้งระบบจะเป็นภาษาไทย — HTTP header
//    เป็น ByteString ตามสเปก fetch จึงโยน TypeError ตั้งแต่ยังไม่ได้ยิงถ้ามี
//    อักษรไทยอยู่ใน Authorization (พังก่อนถึงเซิร์ฟเวอร์ ไม่ใช่ผลลัพธ์ที่ตรวจอยู่)
const garbage = await api('/workspaces/current', { method: 'GET', token: 'pmt_notarealtokenatall' })
check('token มั่ว → 401', garbage.status === 401, JSON.stringify(garbage.body))

// แก้ตัวอักษรตัวเดียว — จับกรณีที่เผลอเทียบแบบ prefix หรือตัดตัวท้ายทิ้ง
const flipped = `${tokenA.slice(0, -1)}${tokenA.at(-1) === 'A' ? 'B' : 'A'}`
check('เปลี่ยนตัวอักษรท้ายตัวเดียว → 401',
  (await api('/workspaces/current', { method: 'GET', token: flipped })).status === 401)

check('ไม่ส่ง Authorization เลย → 401',
  (await api('/workspaces/current', { method: 'GET' })).status === 401)

section('last_used_at บอกได้ว่าเครื่องปลายทางตั้งค่าสำเร็จหรือยัง')

const afterUse = await api('/workspaces/current/tokens', { method: 'GET', ...asOwnerA })
const usedRow = afterUse.body?.data?.find((t) => t.id === created.body?.data?.id)
check('ใบที่ใช้ไปแล้วมี lastUsedAt', usedRow?.lastUsedAt !== undefined, JSON.stringify(usedRow))

const unusedRow = afterUse.body?.data?.find((t) => t.id === second.body?.data?.id)
check('ใบที่ยังไม่เคยใช้ยังไม่มี lastUsedAt', unusedRow?.lastUsedAt === undefined,
  JSON.stringify(unusedRow))

section('วันหมดอายุ')

const expiring = await api('/workspaces/current/tokens', {
  body: { name: 'ใบหมดอายุ 30 วัน', expiresInDays: 30 }, ...asOwnerA,
})
check('ออกใบที่มีวันหมดอายุได้', expiring.status === 200, JSON.stringify(expiring.body))

const expiresAt = Date.parse(expiring.body?.data?.expiresAt ?? '')
const target = Date.now() + 30 * 24 * 60 * 60 * 1000
check('expiresAt ห่างจากตอนนี้ราว 30 วัน', Math.abs(expiresAt - target) < 60_000,
  expiring.body?.data?.expiresAt)

check('ใบที่ยังไม่หมดอายุใช้ได้ปกติ',
  (await api('/workspaces/current', { method: 'GET', token: expiring.body?.data?.token })).status === 200)

// ⚠️ เส้นทาง "หมดอายุแล้วใช้ไม่ได้" ตรวจที่นี่ไม่ได้ เพราะไม่มีทางเลื่อนนาฬิกา
//    ผ่าน HTTP — เงื่อนไขเดียวกัน (ExpiresAt <= now) อยู่ใน ApiToken.IsActive
//    ซึ่งทั้ง ResolveAsync และ DescribeStatus เรียกใช้ร่วมกัน ข้อที่ตรวจได้จริง
//    คือ "ตั้งวันหมดอายุแล้วมันถูกบันทึกจริง" ซึ่งอยู่ข้างบน

section('เพิกถอน — ต้องมีผลทันทีและเฉพาะใบนั้น')

const revoked = await api(`/workspaces/current/tokens/${created.body?.data?.id}`, {
  method: 'DELETE', ...asOwnerA,
})
check('เพิกถอนสำเร็จ', revoked.status === 200, JSON.stringify(revoked.body))

// ─────────────────────────────────────────────────────────────────────────
//  ไม่มี sleep ตรงนี้โดยเจตนา
//
//  ถ้าวันหนึ่งมีคนใส่ cache หน้า ApiTokenRepository.ResolveAsync เพื่อลดคิวรี
//  ต่อ request ข้อนี้จะแดงทันที ซึ่งเป็นสิ่งที่ต้องการ — "เพิกถอนแล้วมีผล
//  ทันที" เป็นคำสัญญา ไม่ใช่ผลข้างเคียงที่ยอมแลกได้
// ─────────────────────────────────────────────────────────────────────────
const afterRevoke = await api('/workspaces/current', { method: 'GET', token: tokenA })
check('ใช้ใบที่เพิกถอนแล้ว → 401 ในคำขอถัดไปเลย', afterRevoke.status === 401,
  JSON.stringify(afterRevoke.body))

check('ใบอื่นของ workspace เดียวกันยังใช้ได้',
  (await api('/workspaces/current', { method: 'GET', token: tokenA2 })).status === 200)

const listAfter = await api('/workspaces/current/tokens', { method: 'GET', ...asOwnerA })
const revokedRow = listAfter.body?.data?.find((t) => t.id === created.body?.data?.id)
check('ใบที่เพิกถอนยังอยู่ในรายการแต่สถานะเป็น revoked', revokedRow?.status === 'revoked',
  JSON.stringify(revokedRow))

const twice = await api(`/workspaces/current/tokens/${created.body?.data?.id}`, {
  method: 'DELETE', ...asOwnerA,
})
check('เพิกถอนซ้ำ → 404', twice.status === 404 && twice.body?.code === 'token_not_found',
  JSON.stringify(twice.body))

const foreign = await api(`/workspaces/current/tokens/${second.body?.data?.id}`, {
  method: 'DELETE', ...asOwnerB,
})
check('เพิกถอนใบของ workspace อื่นไม่ได้ (แม้เป็น owner ทั้งสองอัน)', foreign.status === 404,
  JSON.stringify(foreign.body))
check('  และใบนั้นยังใช้ได้จริง',
  (await api('/workspaces/current', { method: 'GET', token: tokenA2 })).status === 200)

section('ทางเดิมยังไม่พัง — JWT ของเบราว์เซอร์')

// เพิ่ม authentication scheme ที่สองแล้ว scheme เดิมพังได้ทั้งระบบโดยที่
// การทดสอบ token อย่างเดียวจะเขียวหมด
check('JWT + X-Workspace-Id ยังใช้ได้',
  (await api('/pages', { method: 'GET', ...asOwnerA })).status === 200)

check('JWT ที่ไม่ส่ง X-Workspace-Id ยังเรียก endpoint ที่ไม่ผูก workspace ได้',
  (await api('/workspaces', { method: 'GET', token: ownerToken })).status === 200)

const badJwt = await api('/pages', { method: 'GET', token: 'neither-a-jwt-nor-a-pmt-token', workspaceId: idA })
check('ค่าที่ไม่ใช่ทั้งสองแบบ → 401', badJwt.status === 401, JSON.stringify(badJwt.body))

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}สรุป${C.off} ${C.green}ผ่าน ${passed}${C.off} / ${failed > 0 ? C.red : C.dim}ไม่ผ่าน ${failed}${C.off}`)

if (failed > 0) {
  console.log(`\n${C.red}เคสที่ไม่ผ่าน:${C.off}`)
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('')
