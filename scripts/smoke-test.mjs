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

  // ─── timing: bcrypt ต้องรันทั้งสองกรณี ไม่งั้นเวลาตอบต่างกันจนเดาได้ ───
  const timeOf = async (email) => {
    const started = process.hrtime.bigint()
    await call('POST', '/auth/login', { body: { email, password: 'รหัสผ่านผิดแน่นอนเลยนะ' } })
    return Number(process.hrtime.bigint() - started) / 1e6
  }
  const withAccount = await timeOf(account.email)
  const withoutAccount = await timeOf(`ไม่มีคนนี้.${stamp}@ทดสอบ.local`)
  const ratio = Math.max(withAccount, withoutAccount) / Math.min(withAccount, withoutAccount)
  check(`เวลาตอบใกล้เคียงกัน (${withAccount.toFixed(0)}ms vs ${withoutAccount.toFixed(0)}ms, ratio ${ratio.toFixed(2)})`,
    ratio < 2,
    'ถ้าต่างกันมาก แปลว่าไม่ได้รัน bcrypt ตอนไม่พบ user → ใช้เดารายชื่ออีเมลได้')

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
