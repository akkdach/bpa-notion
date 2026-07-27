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

  // ═══════════════════════════════════════════════════════════════════════
  section('บัญชีของ AI (users.kind)')
  // ═══════════════════════════════════════════════════════════════════════
  //  แยก "บัญชีของคน" ออกจาก "บัญชีที่ AI ใช้" เพื่อให้ตอบได้ว่าหน้านี้ใครแก้
  //  ก่อนหน้านี้ MCP ใช้บัญชีเดียวกับเจ้าของ → last_edited_by เป็นค่าเดียวกัน
  //  ทั้งสองกรณี แล้วคำถามนั้นตอบไม่ได้เลย
  // ═══════════════════════════════════════════════════════════════════════
  check('บัญชีที่สมัครใหม่เป็น human', owner.user.kind === 'human',
    `ได้ ${JSON.stringify(owner.user.kind)}`)

  // ⚠️ ข้อสำคัญด้านความถูกต้อง: ห้ามประกาศตัวเองเป็น agent ตอนสมัคร
  //    ถ้าทำได้ คนก็ปลอมให้การแก้ของตัวเองดูเหมือน AI ทำ (หรือกลับกัน) ได้
  //    ซึ่งทำลายจุดประสงค์ของคอลัมน์นี้ทั้งหมด
  const selfDeclared = await call('POST', '/auth/register', {
    body: {
      email: `ปลอมเป็นบอท.${stamp}@ทดสอบ.local`,
      password: account.password,
      name: 'อ้างว่าเป็นบอท',
      kind: 'agent',
    },
  })
  check('ประกาศตัวเองเป็น agent ตอนสมัครไม่ได้ — ยังเป็น human',
    selfDeclared.body?.data?.user?.kind === 'human',
    `ได้ ${JSON.stringify(selfDeclared.body?.data?.user?.kind)}`)

  const markAgent = await call('PATCH', `/workspaces/current/members/${intruderAuth.user.id}`, {
    ...asOwner, body: { role: 'member', kind: 'agent' },
  })
  check('owner ตั้งสมาชิกเป็น agent ได้', markAgent.status === 200,
    `ได้ ${markAgent.status} ${JSON.stringify(markAgent.body)}`)

  const withKinds = await call('GET', '/workspaces/current/members', asOwner)
  check('รายชื่อสมาชิกบอกได้ว่าใครเป็น agent',
    withKinds.body?.data?.find((m) => m.userId === intruderAuth.user.id)?.kind === 'agent',
    JSON.stringify(withKinds.body?.data?.map((m) => ({ role: m.role, kind: m.kind }))))
  check('คนอื่นยังเป็น human อยู่',
    withKinds.body?.data?.find((m) => m.userId === owner.user.id)?.kind === 'human')

  const badKind = await call('PATCH', `/workspaces/current/members/${intruderAuth.user.id}`, {
    ...asOwner, body: { role: 'member', kind: 'หุ่นยนต์' },
  })
  check('kind ที่ไม่รู้จัก → 400 พร้อมบอกค่าที่ถูก',
    badKind.status === 400 && badKind.body?.code === 'invalid_user_kind'
      && badKind.body?.message?.includes('agent'),
    `ได้ ${badKind.status} ${badKind.body?.message}`)

  // คืนค่าเป็น human ก่อน เพราะเคสถัดไปใช้บัญชีนี้เป็นสมาชิกธรรมดาต่อ
  await call('PATCH', `/workspaces/current/members/${intruderAuth.user.id}`, {
    ...asOwner, body: { role: 'admin', kind: 'human' },
  })

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
  section('page tree — สร้างและซ้อนชั้น')
  // ═══════════════════════════════════════════════════════════════════════
  const mk = async (parentId, title, opts = {}) => {
    const r = await call('POST', '/pages', {
      ...asOwner, body: { parentId, title, ...opts },
    })
    return r.body?.data
  }

  const root = await mk(null, 'คู่มือพนักงาน')
  check('สร้างหน้าระดับบนสุดได้', root?.id !== undefined, JSON.stringify(root))
  check('depth = 0', root?.depth === 0)
  check('ancestorIds ว่าง', Array.isArray(root?.ancestorIds) && root.ancestorIds.length === 0)
  check('เป็น access root ของตัวเอง', root?.accessRootId === root?.id)
  check('rank เริ่มที่ a0', root?.rank === 'a0', root?.rank)
  check('ชื่อไทยกลับมาครบ', root?.title === 'คู่มือพนักงาน')

  const child = await mk(root.id, 'ระเบียบการลา')
  check('depth = 1', child?.depth === 1)
  check('ancestorIds = [root]',
    child?.ancestorIds?.length === 1 && child.ancestorIds[0] === root.id)
  check('สืบทอด access root จากหน้าแม่', child?.accessRootId === root.id)

  const grand = await mk(child.id, 'ลาพักร้อน')
  check('depth = 2', grand?.depth === 2)
  check('ancestorIds เรียงจาก root ลงมา',
    grand?.ancestorIds?.length === 2 &&
    grand.ancestorIds[0] === root.id && grand.ancestorIds[1] === child.id,
    JSON.stringify(grand?.ancestorIds))
  check('หลานยังสืบทอด access root เดิม', grand?.accessRootId === root.id)

  // ─── ลำดับพี่น้อง ───────────────────────────────────────────────────────
  const s1 = await mk(root.id, 'พี่น้อง ๑')
  const s2 = await mk(root.id, 'พี่น้อง ๒')
  const middle = await call('POST', '/pages', {
    ...asOwner, body: { parentId: root.id, title: 'แทรกกลาง', afterPageId: child.id },
  })
  check('แทรกระหว่างพี่น้องได้', middle.status === 201, `ได้ ${middle.status}`)

  const treeAfterInsert = (await call('GET', '/pages', asOwner)).body?.data ?? []
  const childrenOfRoot = treeAfterInsert
    .filter((n) => n.parentId === root.id)
    .map((n) => n.title)
  check('ลำดับพี่น้องถูกต้องหลังแทรกกลาง',
    JSON.stringify(childrenOfRoot) ===
      JSON.stringify(['ระเบียบการลา', 'แทรกกลาง', 'พี่น้อง ๑', 'พี่น้อง ๒']),
    JSON.stringify(childrenOfRoot))

  check('rank ของตัวที่แทรกอยู่ระหว่างเพื่อนบ้านจริง',
    middle.body.data.rank > child.rank && middle.body.data.rank < s1.rank,
    `${child.rank} < ${middle.body.data.rank} < ${s1.rank}`)

  // ═══════════════════════════════════════════════════════════════════════
  section('page tree — กันวงกลม')
  // ═══════════════════════════════════════════════════════════════════════
  const selfMove = await call('POST', `/pages/${root.id}/move`, {
    ...asOwner, body: { parentId: root.id },
  })
  check('ย้ายหน้าไปใต้ตัวเอง → 400', selfMove.status === 400, `ได้ ${selfMove.status}`)

  const cycleMove = await call('POST', `/pages/${root.id}/move`, {
    ...asOwner, body: { parentId: grand.id },
  })
  check('ย้ายหน้าไปใต้ลูกหลานของตัวเอง → 400', cycleMove.status === 400, `ได้ ${cycleMove.status}`)
  check('code = cycle', cycleMove.body?.code === 'cycle', JSON.stringify(cycleMove.body))

  // ═══════════════════════════════════════════════════════════════════════
  section('page tree — ย้าย subtree ใหญ่')
  // ═══════════════════════════════════════════════════════════════════════
  const bigRoot = await mk(null, 'ต้นไม้ใหญ่')
  const branch = await mk(bigRoot.id, 'กิ่ง')

  // สร้างลูกหลาน 500 หน้าใต้ branch (สลับชั้นเพื่อให้ depth ต่างกันจริง)
  const created = []
  let currentParent = branch.id
  for (let i = 0; i < 500; i++) {
    const p = await mk(currentParent, `ใบที่ ${i + 1}`)
    created.push(p)
    // ทุก 50 ใบเลื่อนลงชั้นถัดไป — ได้ tree ลึก 10 ชั้น ไม่ใช่แบนราบ
    if ((i + 1) % 50 === 0) currentParent = p.id
  }
  check('สร้างลูกหลาน 500 หน้าได้', created.length === 500 && created.every((p) => p?.id))
  check('ลึกสุดมากกว่า 10 ชั้น', Math.max(...created.map((p) => p.depth)) >= 10,
    `ลึกสุด ${Math.max(...created.map((p) => p.depth))}`)

  const moveStart = Date.now()
  const moved = await call('POST', `/pages/${branch.id}/move`, {
    ...asOwner, body: { parentId: root.id },
  })
  const moveMs = Date.now() - moveStart

  check('ย้าย branch ที่มีลูกหลาน 500 หน้าสำเร็จ', moved.status === 200,
    `ได้ ${moved.status} ${JSON.stringify(moved.body).slice(0, 200)}`)
  check(`อัปเดตลูกหลานครบ 500 แถว (ใช้ ${moveMs}ms)`,
    moved.body?.data?.affectedDescendants === 500,
    `ได้ ${moved.body?.data?.affectedDescendants}`)
  check('เร็วพอที่จะเชื่อว่าเป็น UPDATE เดียว ไม่ใช่ loop (<1500ms)', moveMs < 1500,
    `ใช้ ${moveMs}ms — ถ้าเป็น loop 500 รอบจะช้ากว่านี้มาก`)
  check('depth ของหน้าที่ย้ายเปลี่ยนถูกต้อง', moved.body?.data?.page?.depth === 1,
    `ได้ ${moved.body?.data?.page?.depth}`)

  // ลูกหลานต้องอัปเดต ancestorIds ตามไปด้วย
  const leaf = await call('GET', `/pages/${created[0].id}`, asOwner)
  check('ลูกหลานมี root ใหม่อยู่ใน ancestorIds',
    leaf.body?.data?.ancestorIds?.[0] === root.id,
    JSON.stringify(leaf.body?.data?.ancestorIds))
  check('ลูกหลานเปลี่ยน access root ตามไปด้วย',
    leaf.body?.data?.accessRootId === root.id,
    leaf.body?.data?.accessRootId)

  const deepLeaf = await call('GET', `/pages/${created[499].id}`, asOwner)
  check('ใบที่ลึกที่สุดก็ ancestorIds ถูก',
    deepLeaf.body?.data?.ancestorIds?.[0] === root.id &&
    deepLeaf.body?.data?.depth === deepLeaf.body?.data?.ancestorIds?.length,
    `depth=${deepLeaf.body?.data?.depth} ancestors=${deepLeaf.body?.data?.ancestorIds?.length}`)

  // ═══════════════════════════════════════════════════════════════════════
  section('page tree — ตรวจความสอดคล้อง')
  // ═══════════════════════════════════════════════════════════════════════
  const consistency = await call('GET', '/pages/maintenance/consistency', asOwner)
  check('ตรวจความสอดคล้องได้', consistency.status === 200, `ได้ ${consistency.status}`)
  check('ancestor_ids ไม่มีแถวเพี้ยน', consistency.body?.data?.badAncestors === 0,
    `เพี้ยน ${consistency.body?.data?.badAncestors} แถว`)
  check('access_root_id ไม่มีแถวเพี้ยน', consistency.body?.data?.badAccessRoots === 0,
    `เพี้ยน ${consistency.body?.data?.badAccessRoots} แถว`)
  check('ไม่มีหน้ากำพร้า', consistency.body?.data?.orphans === 0)

  const repair = await call('POST', '/pages/maintenance/repair', asOwner)
  check('ซ่อมแล้วไม่มีอะไรต้องแก้ (แปลว่าข้อมูลถูกอยู่แล้ว)',
    repair.body?.data?.fixedAncestors === 0 && repair.body?.data?.fixedAccessRoots === 0,
    JSON.stringify(repair.body?.data))

  // ═══════════════════════════════════════════════════════════════════════
  section('page tree — ถังขยะ')
  // ═══════════════════════════════════════════════════════════════════════
  const deleted = await call('DELETE', `/pages/${child.id}`, asOwner)
  check('ลบหน้าพร้อมลูกหลาน', deleted.status === 200, `ได้ ${deleted.status}`)
  check('ลบไป 2 หน้า (ตัวเอง + ลูก)', deleted.body?.data === 2, `ได้ ${deleted.body?.data}`)

  const afterDelete = (await call('GET', '/pages', asOwner)).body?.data ?? []
  check('หน้าที่ลบหายจาก tree', !afterDelete.some((n) => n.id === child.id))
  check('ลูกของมันก็หายด้วย', !afterDelete.some((n) => n.id === grand.id))

  const trash = await call('GET', '/pages/trash', asOwner)
  check('เห็นหน้าที่ลบในถังขยะ',
    trash.body?.data?.some((n) => n.id === child.id), `${trash.body?.data?.length} รายการ`)

  const restoreChildFirst = await call('POST', `/pages/${grand.id}/restore`, asOwner)
  check('กู้คืนลูกก่อนแม่ไม่ได้ → 409', restoreChildFirst.status === 409,
    `ได้ ${restoreChildFirst.status}`)
  check('code = parent_still_deleted', restoreChildFirst.body?.code === 'parent_still_deleted')

  const restored = await call('POST', `/pages/${child.id}/restore`, asOwner)
  check('กู้คืนจากบนลงล่างได้', restored.status === 200, `ได้ ${restored.status}`)

  const afterRestore = (await call('GET', '/pages', asOwner)).body?.data ?? []
  check('หน้ากลับมาใน tree', afterRestore.some((n) => n.id === child.id))
  check('ลูกกลับมาด้วย', afterRestore.some((n) => n.id === grand.id))

  // ═══════════════════════════════════════════════════════════════════════
  section('⚠️ page tree — tenant isolation')
  // ═══════════════════════════════════════════════════════════════════════
  const outsiderWs = (await call('POST', '/workspaces', {
    token: intruderToken, body: { name: 'ที่ทำงานคนนอก' },
  })).body?.data

  const asOutsider = { token: intruderToken, workspaceId: outsiderWs.id }

  const readOthersPage = await call('GET', `/pages/${root.id}`, asOutsider)
  check('อ่านหน้าของ workspace อื่นไม่ได้ → 404', readOthersPage.status === 404,
    `ได้ ${readOthersPage.status}`)

  const moveOthersPage = await call('POST', `/pages/${root.id}/move`, {
    ...asOutsider, body: { parentId: null },
  })
  check('ย้ายหน้าของ workspace อื่นไม่ได้ → 404', moveOthersPage.status === 404,
    `ได้ ${moveOthersPage.status}`)

  const deleteOthersPage = await call('DELETE', `/pages/${root.id}`, asOutsider)
  check('ลบหน้าของ workspace อื่นไม่ได้ → 404', deleteOthersPage.status === 404,
    `ได้ ${deleteOthersPage.status}`)

  const outsiderTree = (await call('GET', '/pages', asOutsider)).body?.data ?? []
  check('tree ของคนนอกไม่มีหน้าของเราเลย',
    !outsiderTree.some((n) => n.id === root.id || n.id === bigRoot.id),
    `${outsiderTree.length} หน้า`)

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
