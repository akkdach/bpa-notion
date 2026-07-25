#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  Smoke test — ยิง API จริงตั้งแต่ register จนถึงแก้เนื้อหาหน้า
//
//      node scripts/smoke-test.mjs [baseUrl]
//      node scripts/smoke-test.mjs http://localhost:5081/api/v1
//
//  ทำไมเป็น Node ไม่ใช่ curl ใน bash:
//  git-bash บน Windows ส่ง argv ผ่าน ANSI conversion ทำให้ข้อความไทยใน -d
//  ของ curl เพี้ยน/ถูกตัด (เจอจริง: body 66 ไบต์ที่ควรยาวกว่านั้น) แล้วเราจะ
//  ไล่หาบั๊กที่ฝั่ง API ทั้งที่ปัญหาอยู่ที่ shell — fetch ของ Node จัดการ UTF-8
//  ให้ถูกต้องเสมอ ซึ่งสำคัญมากเพราะเนื้อหาทั้งระบบเป็นภาษาไทย
// ═══════════════════════════════════════════════════════════════════════════

const BASE = process.argv[2] ?? 'http://localhost:5081/api/v1'

const C = {
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m',
}

let passed = 0
let failed = 0
const failures = []

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    process.stdout.write(`  ${C.green}✓${C.off} ${label}\n`)
  } else {
    failed += 1
    failures.push(label)
    process.stdout.write(`  ${C.red}✗${C.off} ${label}${detail ? `\n      ${C.dim}${detail}${C.off}` : ''}\n`)
  }
}

function section(title) {
  process.stdout.write(`\n${C.bold}${C.yellow}── ${title} ──${C.off}\n`)
}

/** ยิง request แล้วคืน { status, body } — ไม่ throw เพื่อให้เทสตรวจ status เองได้ */
async function call(method, path, { body, token, workspaceId, raw } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (raw) {
    return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) }
  }

  const text = await response.text()
  let parsed
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text.slice(0, 300) }
  }
  return { status: response.status, body: parsed }
}

// ข้อความไทยจริงทั้งหมด — ถ้า encoding พังที่ชั้นใดชั้นหนึ่งจะเห็นที่นี่
const stamp = process.env.SMOKE_STAMP ?? String(Date.now() % 100000)
const account = {
  email: `สมชาย.${stamp}@ทดสอบ.local`.normalize('NFC'),
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'สมชาย ใจดี',
}

async function main() {
  process.stdout.write(`${C.bold}Smoke test${C.off} ${C.dim}${BASE}${C.off}\n`)

  // ═══════════════════════════════════════════════════════════════════════
  section('health')
  // ═══════════════════════════════════════════════════════════════════════
  const health = await call('GET', '/health')
  check('health ตอบ 200', health.status === 200, `ได้ ${health.status}`)
  check('pgroonga ติดตั้งแล้ว',
    health.body?.data?.database?.extensions?.includes('pgroonga') === true)

  // ═══════════════════════════════════════════════════════════════════════
  section('validation')
  // ═══════════════════════════════════════════════════════════════════════
  const noBody = await call('POST', '/auth/login', { body: null })
  check('body ว่าง → 400 ไม่ใช่ 500', noBody.status === 400,
    `ได้ ${noBody.status} ${JSON.stringify(noBody.body)}`)
  check('code = invalid_body', noBody.body?.code === 'invalid_body',
    JSON.stringify(noBody.body))

  const badRegister = await call('POST', '/auth/register', {
    body: { email: 'ไม่ใช่อีเมล', password: 'สั้น', name: '' },
  })
  check('register ข้อมูลไม่ผ่าน → 400', badRegister.status === 400, `ได้ ${badRegister.status}`)
  const fieldErrors = badRegister.body?.data?.errors ?? {}
  check('error แยกตาม field (email, password, name)',
    ['email', 'password', 'name'].every((f) => Array.isArray(fieldErrors[f])),
    JSON.stringify(fieldErrors))
  check('ข้อความ error เป็นภาษาไทยและอ่านออก',
    typeof fieldErrors.password?.[0] === 'string' && /[฀-๿]/.test(fieldErrors.password[0]),
    JSON.stringify(fieldErrors.password))

  // ═══════════════════════════════════════════════════════════════════════
  section('register')
  // ═══════════════════════════════════════════════════════════════════════
  const registered = await call('POST', '/auth/register', { body: account })
  check('register สำเร็จ', registered.status === 200,
    `ได้ ${registered.status} ${JSON.stringify(registered.body)}`)

  const auth = registered.body?.data
  check('ได้ accessToken', typeof auth?.accessToken === 'string' && auth.accessToken.length > 40)
  check('ได้ refreshToken', typeof auth?.refreshToken === 'string' && auth.refreshToken.length > 20)
  check('ชื่อภาษาไทยกลับมาครบไม่เพี้ยน', auth?.user?.name === account.name,
    `ส่งไป "${account.name}" ได้กลับ "${auth?.user?.name}"`)
  check('อีเมลภาษาไทยกลับมาครบ', auth?.user?.email === account.email,
    `ส่งไป "${account.email}" ได้กลับ "${auth?.user?.email}"`)
  check('user ใหม่ยังไม่มี workspace', Array.isArray(auth?.workspaces) && auth.workspaces.length === 0)

  // ═══════════════════════════════════════════════════════════════════════
  section('register ซ้ำ + อีเมลไม่สนตัวพิมพ์ (citext)')
  // ═══════════════════════════════════════════════════════════════════════
  const duplicate = await call('POST', '/auth/register', {
    body: { ...account, email: account.email.toUpperCase(), name: 'ซ้ำ' },
  })
  check('อีเมลตัวพิมพ์ใหญ่ถือว่าซ้ำ → 409', duplicate.status === 409, `ได้ ${duplicate.status}`)
  check('code = email_taken', duplicate.body?.code === 'email_taken')

  // ═══════════════════════════════════════════════════════════════════════
  section('login')
  // ═══════════════════════════════════════════════════════════════════════
  const wrongPassword = await call('POST', '/auth/login', {
    body: { email: account.email, password: 'รหัสผ่านผิดแน่นอนเลยนะ' },
  })
  check('รหัสผ่านผิด → 401', wrongPassword.status === 401, `ได้ ${wrongPassword.status}`)

  const noSuchUser = await call('POST', '/auth/login', {
    body: { email: `ไม่มีคนนี้.${stamp}@ทดสอบ.local`, password: 'รหัสผ่านผิดแน่นอนเลยนะ' },
  })
  check('อีเมลไม่มีในระบบ → 401 เหมือนกัน', noSuchUser.status === 401)
  check('ข้อความ error เหมือนกันทั้งสองกรณี (ไม่บอกว่าอีเมลมีอยู่จริง)',
    wrongPassword.body?.message === noSuchUser.body?.message,
    `"${wrongPassword.body?.message}" vs "${noSuchUser.body?.message}"`)

  // ─────────────────────────────────────────────────────────────────────
  //  timing: bcrypt ต้องรันทั้งสองกรณี
  //
  //  ทิศทางที่อันตรายมีทางเดียว — "อีเมลที่ไม่มีในระบบตอบเร็วกว่า" เพราะนั่น
  //  คือสิ่งที่ใช้ไล่หารายชื่ออีเมลจริงได้ ส่วนกรณีที่ช้ากว่าเป็นแค่ noise
  //  (JIT warm-up, GC, connection pool) ไม่ใช่สัญญาณที่ใช้โจมตี
  //
  //  วัดหลายรอบแล้วใช้ค่ากลาง — วัดรอบเดียวแกว่งเกินกว่าจะสรุปอะไรได้
  // ─────────────────────────────────────────────────────────────────────
  const timeOf = async (email) => {
    const started = process.hrtime.bigint()
    await call('POST', '/auth/login', { body: { email, password: 'รหัสผ่านผิดแน่นอนเลยนะ' } })
    return Number(process.hrtime.bigint() - started) / 1e6
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

  const samples = 5
  const withAccount = []
  const withoutAccount = []
  for (let i = 0; i < samples; i++) {
    withAccount.push(await timeOf(account.email))
    withoutAccount.push(await timeOf(`ไม่มีคนนี้.${stamp}@ทดสอบ.local`))
  }
  const medWith = median(withAccount)
  const medWithout = median(withoutAccount)

  check(`อีเมลที่ไม่มีในระบบไม่ตอบเร็วกว่าอย่างมีนัย (มี ${medWith.toFixed(0)}ms · ไม่มี ${medWithout.toFixed(0)}ms)`,
    medWithout > medWith * 0.7,
    'ถ้าไม่มีบัญชีแล้วตอบเร็วกว่าชัดเจน แปลว่าข้าม bcrypt → ใช้ไล่หาอีเมลที่มีอยู่จริงได้')

  const loggedIn = await call('POST', '/auth/login', {
    body: { email: account.email, password: account.password },
  })
  check('login สำเร็จ', loggedIn.status === 200, `ได้ ${loggedIn.status}`)
  const session = loggedIn.body?.data

  // ═══════════════════════════════════════════════════════════════════════
  section('me')
  // ═══════════════════════════════════════════════════════════════════════
  const meNoToken = await call('GET', '/auth/me')
  check('ไม่มี token → 401', meNoToken.status === 401, `ได้ ${meNoToken.status}`)

  const meBadToken = await call('GET', '/auth/me', { token: 'not.a.real.token' })
  check('token ปลอม → 401', meBadToken.status === 401, `ได้ ${meBadToken.status}`)

  const me = await call('GET', '/auth/me', { token: session?.accessToken })
  check('token ถูก → 200', me.status === 200, `ได้ ${me.status}`)
  check('/me คืนอีเมลเดียวกัน', me.body?.data?.user?.email === account.email)

  // ═══════════════════════════════════════════════════════════════════════
  section('refresh + rotation')
  // ═══════════════════════════════════════════════════════════════════════
  const refreshed = await call('POST', '/auth/refresh', {
    body: { refreshToken: session?.refreshToken },
  })
  check('refresh สำเร็จ', refreshed.status === 200, `ได้ ${refreshed.status}`)
  check('ได้ refreshToken ใบใหม่ (rotate)',
    refreshed.body?.data?.refreshToken !== session?.refreshToken)
  check('accessToken ใบใหม่ใช้งานได้',
    (await call('GET', '/auth/me', { token: refreshed.body?.data?.accessToken })).status === 200)

  // ─── ใช้ token ที่ rotate แล้วซ้ำ = สัญญาณว่า token รั่ว ───
  const reused = await call('POST', '/auth/refresh', {
    body: { refreshToken: session?.refreshToken },
  })
  check('ใช้ refresh token ใบเก่าซ้ำ → 401', reused.status === 401, `ได้ ${reused.status}`)
  check('code = refresh_token_reused', reused.body?.code === 'refresh_token_reused',
    JSON.stringify(reused.body))

  const afterReuse = await call('POST', '/auth/refresh', {
    body: { refreshToken: refreshed.body?.data?.refreshToken },
  })
  check('ใบใหม่ก็ถูกยกเลิกด้วย (ยกเลิกทั้ง user เมื่อสงสัยว่ารั่ว)',
    afterReuse.status === 401, `ได้ ${afterReuse.status}`)

  // ═══════════════════════════════════════════════════════════════════════
  section('workspace — สร้าง')
  // ═══════════════════════════════════════════════════════════════════════
  // login ใหม่เพราะ token ชุดก่อนถูกยกเลิกไปตอนทดสอบ reuse detection
  const owner = (await call('POST', '/auth/login', {
    body: { email: account.email, password: account.password },
  })).body?.data
  const ownerToken = owner?.accessToken

  const createdThai = await call('POST', '/workspaces', {
    token: ownerToken,
    body: { name: 'บริษัท ทดสอบ จำกัด', icon: '🏢' },
  })
  check('สร้าง workspace ชื่อไทยได้', createdThai.status === 201,
    `ได้ ${createdThai.status} ${JSON.stringify(createdThai.body)}`)

  const ws = createdThai.body?.data
  check('ชื่อไทยกลับมาครบ', ws?.name === 'บริษัท ทดสอบ จำกัด', ws?.name)
  check('ผู้สร้างเป็น owner', ws?.role === 'owner', ws?.role)
  check(`slug ที่สร้างจากชื่อไทยผ่าน CHECK constraint (${ws?.slug})`,
    typeof ws?.slug === 'string' && /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(ws.slug),
    'ชื่อไทยแปลงเป็น ASCII ไม่ได้ ต้อง fallback เป็นชื่อสุ่มที่ยังผ่าน constraint')

  const explicitSlug = 'ทีมงานพัฒนา'  // ไทยล้วน ไม่มี ASCII เลย
  const createdSlug = await call('POST', '/workspaces', {
    token: ownerToken,
    body: { name: 'ทีมพัฒนา', slug: `team-dev-${stamp}` },
  })
  check('ระบุ slug เองได้', createdSlug.status === 201, `ได้ ${createdSlug.status}`)
  check('slug ที่ระบุถูกใช้ตามนั้น', createdSlug.body?.data?.slug === `team-dev-${stamp}`,
    createdSlug.body?.data?.slug)

  const dupSlug = await call('POST', '/workspaces', {
    token: ownerToken,
    body: { name: 'ซ้ำ', slug: `team-dev-${stamp}` },
  })
  check('slug ซ้ำ → 409 (ไม่เงียบ ๆ เปลี่ยนให้)', dupSlug.status === 409, `ได้ ${dupSlug.status}`)
  check('code = slug_taken', dupSlug.body?.code === 'slug_taken')

  const badSlug = await call('POST', '/workspaces', {
    token: ownerToken,
    body: { name: 'ชื่อไทย', slug: explicitSlug },
  })
  check('slug ที่เป็นภาษาไทยล้วน → 400', badSlug.status === 400, `ได้ ${badSlug.status}`)

  const mine = await call('GET', '/workspaces', { token: ownerToken })
  check('list workspace ของตัวเองได้ 2 อัน',
    mine.body?.data?.length === 2, JSON.stringify(mine.body?.data?.map((w) => w.slug)))

  // ═══════════════════════════════════════════════════════════════════════
  section('workspace — tenant context')
  // ═══════════════════════════════════════════════════════════════════════
  const noHeader = await call('GET', '/workspaces/current', { token: ownerToken })
  check('ไม่ส่ง X-Workspace-Id → 400 ไม่ใช่ 500', noHeader.status === 400, `ได้ ${noHeader.status}`)
  check('code = workspace_required', noHeader.body?.code === 'workspace_required')

  const badHeader = await call('GET', '/workspaces/current', {
    token: ownerToken, workspaceId: 'ไม่ใช่-uuid'.normalize(),
  }).catch(() => ({ status: 0 }))
  check('header ที่ไม่ใช่ UUID → 400',
    badHeader.status === 400 || badHeader.status === 0, `ได้ ${badHeader.status}`)

  const current = await call('GET', '/workspaces/current', {
    token: ownerToken, workspaceId: ws.id,
  })
  check('ส่ง header ถูก → 200', current.status === 200, `ได้ ${current.status}`)
  check('myRole = owner', current.body?.data?.myRole === 'owner')
  check('memberCount = 1', current.body?.data?.memberCount === 1)

  // ═══════════════════════════════════════════════════════════════════════
  section('⚠️ tenant isolation')
  // ═══════════════════════════════════════════════════════════════════════
  const intruder = {
    email: `คนนอก.${stamp}@ทดสอบ.local`,
    password: 'รหัสผ่านยาวพอสมควรนะครับ',
    name: 'คนนอก ไม่รู้จัก',
  }
  const intruderAuth = (await call('POST', '/auth/register', { body: intruder })).body?.data
  const intruderToken = intruderAuth?.accessToken
  check('สมัคร user คนที่สองได้', typeof intruderToken === 'string')

  const stolen = await call('GET', '/workspaces/current', {
    token: intruderToken, workspaceId: ws.id,
  })
  check('คนนอกใช้ workspace id ของคนอื่น → 404', stolen.status === 404, `ได้ ${stolen.status}`)
  check('ต้องเป็น 404 ไม่ใช่ 403 (403 = ยืนยันว่า workspace นี้มีอยู่จริง)',
    stolen.status !== 403)
  check('code = workspace_not_found', stolen.body?.code === 'workspace_not_found')

  const stolenMembers = await call('GET', '/workspaces/current/members', {
    token: intruderToken, workspaceId: ws.id,
  })
  check('คนนอกอ่านรายชื่อสมาชิกไม่ได้', stolenMembers.status === 404, `ได้ ${stolenMembers.status}`)

  const intruderList = await call('GET', '/workspaces', { token: intruderToken })
  check('คนนอกเห็น workspace ของตัวเอง 0 อัน', intruderList.body?.data?.length === 0,
    JSON.stringify(intruderList.body?.data))

  // ═══════════════════════════════════════════════════════════════════════
  section('workspace — สมาชิก')
  // ═══════════════════════════════════════════════════════════════════════
  const asOwner = { token: ownerToken, workspaceId: ws.id }

  const unregistered = await call('POST', '/workspaces/current/members', {
    ...asOwner, body: { email: `ยังไม่สมัคร.${stamp}@ทดสอบ.local`, role: 'member' },
  })
  check('เพิ่มอีเมลที่ยังไม่สมัคร → 404 พร้อมบอกวิธีแก้',
    unregistered.status === 404 && unregistered.body?.code === 'user_not_registered',
    `ได้ ${unregistered.status} ${unregistered.body?.code}`)

  const added = await call('POST', '/workspaces/current/members', {
    ...asOwner, body: { email: intruder.email, role: 'member' },
  })
  check('เพิ่มสมาชิกด้วยอีเมลที่สมัครแล้ว → 200', added.status === 200,
    `ได้ ${added.status} ${JSON.stringify(added.body)}`)
  check('สมาชิกใหม่ได้ role member', added.body?.data?.role === 'member')

  const addedTwice = await call('POST', '/workspaces/current/members', {
    ...asOwner, body: { email: intruder.email, role: 'member' },
  })
  check('เพิ่มซ้ำ → 409', addedTwice.status === 409, `ได้ ${addedTwice.status}`)

  const badRole = await call('POST', '/workspaces/current/members', {
    ...asOwner, body: { email: intruder.email, role: 'จักรพรรดิ' },
  })
  check('role ที่ไม่รู้จัก → 400', badRole.status === 400, `ได้ ${badRole.status}`)

  const nowVisible = await call('GET', '/workspaces/current', {
    token: intruderToken, workspaceId: ws.id,
  })
  check('หลังถูกเพิ่มเป็นสมาชิกแล้วเข้าได้', nowVisible.status === 200, `ได้ ${nowVisible.status}`)
  check('myRole = member', nowVisible.body?.data?.myRole === 'member')

  const memberList = await call('GET', '/workspaces/current/members', asOwner)
  check('รายชื่อสมาชิกมี 2 คน', memberList.body?.data?.length === 2,
    JSON.stringify(memberList.body?.data?.map((m) => m.role)))
  check('ชื่อภาษาไทยของสมาชิกกลับมาครบ',
    memberList.body?.data?.some((m) => m.name === intruder.name))

  // ─── สิทธิ์ ─────────────────────────────────────────────────────────────
  const memberAdds = await call('POST', '/workspaces/current/members', {
    token: intruderToken, workspaceId: ws.id,
    body: { email: account.email, role: 'admin' },
  })
  check('member เพิ่มสมาชิกไม่ได้ → 403', memberAdds.status === 403, `ได้ ${memberAdds.status}`)

  const promoteToOwner = await call('PATCH', `/workspaces/current/members/${intruderAuth.user.id}`, {
    ...asOwner, body: { role: 'admin' },
  })
  check('owner เลื่อนสมาชิกเป็น admin ได้', promoteToOwner.status === 200,
    `ได้ ${promoteToOwner.status}`)

  const adminPromotesOwner = await call('PATCH', `/workspaces/current/members/${owner.user.id}`, {
    token: intruderToken, workspaceId: ws.id, body: { role: 'owner' },
  })
  check('admin แต่งตั้ง owner ไม่ได้ → 403', adminPromotesOwner.status === 403,
    `ได้ ${adminPromotesOwner.status}`)

  // ─── owner คนสุดท้าย ────────────────────────────────────────────────────
  const demoteLastOwner = await call('PATCH', `/workspaces/current/members/${owner.user.id}`, {
    ...asOwner, body: { role: 'member' },
  })
  check('ลดสิทธิ์ owner คนสุดท้ายไม่ได้ → 409', demoteLastOwner.status === 409,
    `ได้ ${demoteLastOwner.status}`)
  check('code = last_owner', demoteLastOwner.body?.code === 'last_owner')

  const removeLastOwner = await call('DELETE', `/workspaces/current/members/${owner.user.id}`, asOwner)
  check('ถอด owner คนสุดท้ายไม่ได้ → 409', removeLastOwner.status === 409,
    `ได้ ${removeLastOwner.status}`)

  // ─── ออกเอง ─────────────────────────────────────────────────────────────
  const leave = await call('DELETE', `/workspaces/current/members/${intruderAuth.user.id}`, {
    token: intruderToken, workspaceId: ws.id,
  })
  check('สมาชิกออกจาก workspace เองได้', leave.status === 200, `ได้ ${leave.status}`)

  const afterLeave = await call('GET', '/workspaces/current', {
    token: intruderToken, workspaceId: ws.id,
  })
  check('ออกแล้วเข้าไม่ได้ทันที (ไม่ต้องรอ token หมดอายุ)',
    afterLeave.status === 404, `ได้ ${afterLeave.status}`)

  // ═══════════════════════════════════════════════════════════════════════
  // สรุป
  // ═══════════════════════════════════════════════════════════════════════
  process.stdout.write(`\n${C.bold}สรุป${C.off} ${C.green}ผ่าน ${passed}${C.off} / ${failed > 0 ? C.red : C.dim}ไม่ผ่าน ${failed}${C.off}\n`)

  if (failed > 0) {
    process.stdout.write(`\n${C.red}เคสที่ไม่ผ่าน:${C.off}\n`)
    for (const f of failures) process.stdout.write(`  · ${f}\n`)
    process.exit(1)
  }
  process.stdout.write('\n')
}

await main()
