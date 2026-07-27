#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  พิสูจน์ว่าการค้นหาภาษาไทยและการอ่านเนื้อหาหน้าใช้ได้จริง
//
//      node scripts/verify-search.mjs [baseUrl]
//
//  ทำไมต้องมีแยกจาก smoke-test: สองเรื่องนี้พังได้แบบที่ HTTP 200 ยังตอบปกติ
//
//    1. ค้นภาษาไทยพังเงียบ ๆ ถ้า PGroonga index ไม่ระบุ tokenizer bigram
//       กับดักคือ "คำที่อยู่ต้นประโยคจะค้นเจอ" เพราะ prefix match ทำงาน
//       เทสที่ใช้คำต้นประโยคจึงผ่านทั้งที่การค้นหาพังหมด
//       → ที่นี่ค้นด้วยคำ "กลาง" ประโยคเท่านั้น
//
//    2. หน้าที่ AI สร้างไม่มีแถวใน page_searches เลยถ้าไม่ได้ seed ตอนสร้าง
//       (คนเขียนแถวนั้นคือเบราว์เซอร์ตอน POST /projection) ผลคือค้นหาไม่เจอ
//       ผลงานของ AI เองตลอดไป — ซึ่งกลับหัวกลับหางกับเป้าหมายทั้งหมด
//       → เคสตัดสิน: สร้างหน้าผ่าน API แล้วค้นชื่อมันทันที ต้องเจอ
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
console.log(`${C.yellow}═══ ตรวจการค้นหาและการอ่านเนื้อหา ═══${C.off}`)

section('เตรียมบัญชีและข้อมูล')

const account = {
  email: `ค้นหา.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'ผู้ทดสอบการค้นหา',
}

const registered = await api('/auth/register', { body: account })
check('สมัครบัญชีใช้แล้วทิ้ง', registered.status === 200, JSON.stringify(registered.body))
const token = registered.body?.data?.accessToken

const ws = await api('/workspaces', { body: { name: `ค้นหา ${stamp}` }, token })
check('สร้าง workspace', ws.status === 201, JSON.stringify(ws.body))
const workspaceId = ws.body?.data?.id

const as = { token, workspaceId }

// ─── หน้าที่ "ไม่มีใครเปิดในเบราว์เซอร์เลย" ────────────────────────────────
const aiTitle = `รายงานยอดขายเครื่องดื่มไตรมาสสาม ${stamp}`
const aiPage = await api('/pages', { body: { parentId: null, title: aiTitle }, ...as })
check('สร้างหน้าแบบที่ AI ทำ (ไม่มีเบราว์เซอร์เกี่ยวข้อง)', aiPage.status === 201,
  JSON.stringify(aiPage.body))
const aiPageId = aiPage.body?.data?.id

section('อ่านเนื้อหาหน้า')

const fresh = await api(`/pages/${aiPageId}/content`, { method: 'GET', ...as })
check('อ่านเนื้อหาหน้าได้', fresh.status === 200, JSON.stringify(fresh.body))
check('หน้าที่เพิ่งสร้างมี freshness = from_document พร้อม body ว่าง',
  fresh.body?.data?.freshness === 'from_document' && fresh.body?.data?.bodyText === '',
  JSON.stringify(fresh.body?.data))
check('คืนชื่อหน้ามาด้วย', fresh.body?.data?.title === aiTitle, fresh.body?.data?.title)
check('บอกเวลาของ projection แยกจากเวลาที่หน้าถูกแก้',
  fresh.body?.data?.projectionUpdatedAt !== undefined
  && fresh.body?.data?.pageUpdatedAt !== undefined,
  JSON.stringify(fresh.body?.data))

// เนื้อหาจริงเข้ามาทาง projection เหมือนที่เบราว์เซอร์ทำ
const body = 'สรุปว่ายอดขายเครื่องดื่มเติบโตขึ้นจากการออกสูตรข้าวผัดกระเพราไก่ในเมนูใหม่'
const projected = await api(`/pages/${aiPageId}/projection`, {
  body: { title: aiTitle, plainText: body }, ...as,
})
check('ส่ง projection ได้ (เลียนแบบเบราว์เซอร์)', projected.status === 200,
  JSON.stringify(projected.body))

const withBody = await api(`/pages/${aiPageId}/content`, { method: 'GET', ...as })
check('อ่านเนื้อหากลับมาได้ครบ', withBody.body?.data?.bodyText === body,
  withBody.body?.data?.bodyText)

const missing = await api('/pages/00000000-0000-0000-0000-000000000000/content', { method: 'GET', ...as })
check('หน้าที่ไม่มีอยู่ → 404', missing.status === 404, `ได้ ${missing.status}`)

section('⚠️ ค้นภาษาไทยด้วยคำกลางประโยค')
// ═══════════════════════════════════════════════════════════════════════════
//  หัวใจของไฟล์นี้
//
//  ห้ามทดสอบด้วยคำต้นประโยค ("รายงาน", "สรุป") — prefix match ทำให้ผ่านแม้
//  tokenizer ผิด กับดักนี้ถูกบันทึกไว้ใน 003_pgroonga_indexes.sql แล้ว
// ═══════════════════════════════════════════════════════════════════════════

const midTitle = await api(`/search?q=${encodeURIComponent('เครื่องดื่ม')}`, { method: 'GET', ...as })
check('ค้นคำกลางชื่อหน้าเจอ ("เครื่องดื่ม" ใน "รายงานยอดขายเครื่องดื่ม…")',
  midTitle.body?.data?.hits?.some((h) => h.id === aiPageId),
  JSON.stringify(midTitle.body?.data))

const midBody = await api(`/search?q=${encodeURIComponent('ข้าวผัด')}`, { method: 'GET', ...as })
check('ค้นคำกลางเนื้อหาเจอ ("ข้าวผัด" ใน "สูตรข้าวผัดกระเพราไก่")',
  midBody.body?.data?.hits?.some((h) => h.id === aiPageId),
  JSON.stringify(midBody.body?.data))

const hit = midBody.body?.data?.hits?.find((h) => h.id === aiPageId)
check('มี snippet ของเนื้อหารอบคำที่เจอ',
  typeof hit?.snippet === 'string' && hit.snippet.includes('ข้าวผัด'), hit?.snippet)
check('มีคะแนนความตรง', typeof hit?.score === 'number', String(hit?.score))

const noise = await api(`/search?q=${encodeURIComponent('ปลาหมึกย่างจานใหญ่')}`, { method: 'GET', ...as })
check('คำที่ไม่มีในเอกสารต้องไม่เจอ (ไม่ over-match)',
  noise.body?.data?.count === 0, JSON.stringify(noise.body?.data))

section('เคสตัดสิน — ค้นเจอหน้าที่ AI สร้างทันที')
// ═══════════════════════════════════════════════════════════════════════════
//  ก่อนที่ PageRepository.AddAsync จะ seed แถวใน page_searches เคสนี้ล้มเสมอ
//  เพราะแถวนั้นเกิดตอนเบราว์เซอร์ POST /projection เท่านั้น
// ═══════════════════════════════════════════════════════════════════════════
const brandNewTitle = `บันทึกการประชุมทีมขนส่งพัสดุ ${stamp}`
const brandNew = await api('/pages', { body: { parentId: null, title: brandNewTitle }, ...as })
const brandNewId = brandNew.body?.data?.id

const immediate = await api(`/search?q=${encodeURIComponent('ขนส่งพัสดุ')}`, { method: 'GET', ...as })
check('สร้างหน้าแล้วค้นชื่อมันเจอทันที ไม่ต้องเปิดในเบราว์เซอร์ก่อน',
  immediate.body?.data?.hits?.some((h) => h.id === brandNewId),
  JSON.stringify(immediate.body?.data))

section('การกรองและ input ที่ผิดรูป')

await api(`/pages/${brandNewId}`, { method: 'PATCH', body: { status: 'doing' }, ...as })

const byStatus = await api(`/search?q=${encodeURIComponent('ขนส่งพัสดุ')}&status=doing`, { method: 'GET', ...as })
check('กรองด้วย status=doing เจอ', byStatus.body?.data?.hits?.some((h) => h.id === brandNewId),
  JSON.stringify(byStatus.body?.data))

const wrongStatus = await api(`/search?q=${encodeURIComponent('ขนส่งพัสดุ')}&status=done`, { method: 'GET', ...as })
check('กรองด้วย status=done ไม่เจอ', wrongStatus.body?.data?.count === 0,
  JSON.stringify(wrongStatus.body?.data))

const badStatus = await api(`/search?q=${encodeURIComponent('ขนส่ง')}&status=ยังไม่เริ่ม`, { method: 'GET', ...as })
check('status ที่ไม่รู้จัก → 400 ไม่ใช่ผลว่าง',
  badStatus.status === 400 && badStatus.body?.code === 'invalid_status',
  `ได้ ${badStatus.status} ${badStatus.body?.code}`)

const short = await api('/search?q=ก', { method: 'GET', ...as })
check('คำค้นสั้นเกินไป → 400 พร้อมเหตุผล',
  short.status === 400 && short.body?.code === 'query_too_short',
  `ได้ ${short.status} ${short.body?.code}`)

// ⚠️ อักขระของ Groonga query syntax ต้องไม่ทำให้คำขอพัง
const specials = ['(', ')', '"', '+ข้าว', '-ผัด', 'ข้าว OR ผัด', '*', '~ทดสอบ']
let allOk = true
let firstBad = ''
for (const special of specials) {
  const r = await api(`/search?q=${encodeURIComponent(special)}`, { method: 'GET', ...as })
  // 200 = ค้นได้ปกติ, 400 = ปฏิเสธเพราะสั้นเกินไป — ทั้งสองอย่างรับได้
  // 500 = query syntax หลุดไปถึง Groonga ซึ่งเป็นสิ่งที่ต้องกัน
  if (r.status !== 200 && r.status !== 400) { allOk = false; firstBad = `${special} → ${r.status} ${JSON.stringify(r.body)}` }
}
check('อักขระพิเศษของ query syntax ไม่ทำให้ 500 (escape ทำงาน)', allOk, firstBad)

section('⚠️ tenant isolation ของการค้นหา')

const outsider = {
  email: `คนนอก.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'คนนอก',
}
const outsiderAuth = await api('/auth/register', { body: outsider })
const outsiderToken = outsiderAuth.body?.data?.accessToken
const outsiderWs = await api('/workspaces', { body: { name: `คนนอก ${stamp}` }, token: outsiderToken })
const outsiderWsId = outsiderWs.body?.data?.id

const leak = await api(`/search?q=${encodeURIComponent('ข้าวผัด')}`, {
  method: 'GET', token: outsiderToken, workspaceId: outsiderWsId,
})
check('คนนอกค้นไม่เจอเนื้อหาของ workspace อื่น',
  leak.body?.data?.count === 0, JSON.stringify(leak.body?.data))

const readLeak = await api(`/pages/${aiPageId}/content`, {
  method: 'GET', token: outsiderToken, workspaceId: outsiderWsId,
})
check('คนนอกอ่านเนื้อหาหน้าของ workspace อื่นไม่ได้ → 404',
  readLeak.status === 404, `ได้ ${readLeak.status}`)

// หน้าที่ถูกลบต้องหลุดออกจากผลค้นหา
await api(`/pages/${brandNewId}`, { method: 'DELETE', ...as })
const afterDelete = await api(`/search?q=${encodeURIComponent('ขนส่งพัสดุ')}`, { method: 'GET', ...as })
check('หน้าที่อยู่ในถังขยะไม่โผล่ในผลค้นหา',
  !afterDelete.body?.data?.hits?.some((h) => h.id === brandNewId),
  JSON.stringify(afterDelete.body?.data))

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}สรุป${C.off} ${C.green}ผ่าน ${passed}${C.off} / ${failed > 0 ? C.red : C.dim}ไม่ผ่าน ${failed}${C.off}`)

if (failed > 0) {
  console.log(`\n${C.red}เคสที่ไม่ผ่าน:${C.off}`)
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('')
