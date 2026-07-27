import { expect, test, type Page } from '@playwright/test'

// ═══════════════════════════════════════════════════════════════════════════
//  เจ้าของตรวจงานที่ AI ทำได้จริงในเบราว์เซอร์
//
//  นี่คือเกณฑ์ผ่านของงานทั้งชุด: "ให้เอไอเข้ามาอ่านงาน จัดการงาน อัปเดทงาน
//  ให้เจ้าของดูงานได้ง่าย"
//
//  เทสจำลอง AI ด้วยการยิง API ตรง ๆ ด้วย token ของบัญชีที่ถูกทำเครื่องหมายว่าเป็น
//  agent — ซึ่งคือสิ่งที่ MCP server ทำจริง แล้วตรวจว่าเจ้าของเห็นผลจากหน้าเว็บ
//
//  ⚠️ ต้องรัน API ไว้ที่ :5081 ก่อน
// ═══════════════════════════════════════════════════════════════════════════

const stamp = String(Date.now() % 1_000_000)
const API = 'http://localhost:5081/api/v1'
const password = 'รหัสผ่านยาวพอสมควรนะครับ'

const owner = {
  email: `เจ้าของ.${stamp}@ทดสอบ.local`,
  password,
  name: 'เจ้าของงาน',
}

const TASK = 'ตรวจสอบยอดขายสาขารังสิต'
const NOTE = 'ดึงข้อมูลจากระบบบัญชีแล้ว เดือนกันยายนยังไม่ปิดงบ'

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'หน้าทั้งหมด' })

/**
 * envelope ที่ API ตอบกลับทุก endpoint (ตรงกับ Helpers/ApiResponse.cs)
 *
 * ประกาศไว้เองเพราะ e2e อยู่คนละ tsconfig กับ src/ จึง import จาก lib/apiClient
 * ไม่ได้ — และการปล่อยเป็น any ทำให้ eslint ฟ้อง no-unsafe-member-access ถูกแล้ว:
 * เทสที่อ่าน .data.id จาก any จะพังตอน runtime ถ้ารูปร่าง response เปลี่ยน
 */
interface Envelope<T> {
  success: boolean
  data: T
}

async function envelope<T>(response: { json: () => Promise<unknown> }): Promise<T> {
  return ((await response.json()) as Envelope<T>).data
}

test.describe.configure({ mode: 'serial' })

// ประกอบใน setup แล้วใช้ต่อทุกเทส (mode: serial รับประกันลำดับ)
let taskId = ''

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('อีเมล').fill(owner.email)
  await page.getByLabel('รหัสผ่าน').fill(owner.password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).first().click()
  await expect(sidebar(page)).toBeVisible()
}

test('เตรียมข้อมูล: AI สร้างงาน เปลี่ยนสถานะ และเขียนบันทึก', async ({ page, request }) => {
  // ─── เจ้าของสมัครและสร้าง workspace ผ่านหน้าเว็บ ──────────────────────────
  await page.goto('/')
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).last().click()
  await page.getByLabel('ชื่อ').fill(owner.name)
  await page.getByLabel('อีเมล').fill(owner.email)
  await page.getByLabel('รหัสผ่าน').fill(owner.password)
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).first().click()

  await expect(page.getByText('ยังไม่มี workspace')).toBeVisible()
  await page.getByRole('button', { name: /เลือก workspace/ }).click()
  await page.getByText('สร้าง workspace ใหม่').click()
  await page.getByLabel('ชื่อ').fill(`ทีมขาย ${stamp}`)
  await page.getByRole('button', { name: 'สร้าง' }).click()
  await expect(page.getByText(`ทีมขาย ${stamp}`)).toBeVisible()

  const stored = await page.evaluate(() => ({
    token: window.localStorage.getItem('pm.accessToken'),
    workspace: window.localStorage.getItem('pm.workspaceId'),
  }))
  const ownerToken = stored.token!
  const workspaceId = stored.workspace!

  const asOwner = {
    Authorization: `Bearer ${ownerToken}`,
    'X-Workspace-Id': workspaceId,
  }

  // ─── สร้างบัญชี AI แล้วให้เจ้าของทำเครื่องหมายว่าเป็น agent ────────────────
  // (เลียนแบบสิ่งที่ scripts/setup-mcp.ps1 ทำ)
  const agentEmail = `claude.${stamp}@ทดสอบ.local`
  const agentReg = await request.post(`${API}/auth/register`, {
    data: { email: agentEmail, password, name: 'Claude (AI)' },
  })
  expect(agentReg.status(), await agentReg.text()).toBe(200)
  const agentAuth = await envelope<{ accessToken: string; user: { id: string } }>(agentReg)
  const agentToken = agentAuth.accessToken
  const agentId = agentAuth.user.id

  await request.post(`${API}/workspaces/current/members`, {
    headers: asOwner,
    data: { email: agentEmail, role: 'member' },
  })
  const marked = await request.patch(`${API}/workspaces/current/members/${agentId}`, {
    headers: asOwner,
    data: { role: 'member', kind: 'agent' },
  })
  expect(marked.status(), await marked.text()).toBe(200)

  const asAgent = {
    Authorization: `Bearer ${agentToken}`,
    'X-Workspace-Id': workspaceId,
  }

  // ─── AI ทำงาน ───────────────────────────────────────────────────────────
  const created = await request.post(`${API}/pages`, {
    headers: asAgent,
    data: { parentId: null, title: TASK, status: 'todo' },
  })
  expect(created.status(), await created.text()).toBe(201)
  taskId = (await envelope<{ id: string }>(created)).id

  await request.patch(`${API}/pages/${taskId}`, {
    headers: asAgent, data: { status: 'doing' },
  })

  const noted = await request.post(`${API}/pages/${taskId}/notes`, {
    headers: asAgent, data: { body: NOTE },
  })
  expect(noted.status(), await noted.text()).toBe(200)
})

test('บอร์ดงานแสดงงานที่ AI สร้างในคอลัมน์ที่ถูก', async ({ page }) => {
  await signIn(page)

  await page.getByRole('button', { name: 'ตรวจงาน', exact: true }).click()
  await expect(page).toHaveURL(/\/review/)

  const doing = page.getByRole('region', { name: 'กำลังทำ' })
  await expect(doing.getByText(TASK)).toBeVisible()

  // คอลัมน์อื่นต้องไม่มีงานนี้
  await expect(page.getByRole('region', { name: 'ยังไม่เริ่ม' }).getByText(TASK)).toBeHidden()
})

test('ย้ายงานข้ามคอลัมน์บนบอร์ดได้ และค่าคงอยู่หลัง refresh', async ({ page }) => {
  await signIn(page)
  await page.goto('/review')

  // ⚠️ ต้องรอ PATCH ตอบก่อน reload — การ์ดย้ายคอลัมน์จาก optimistic update ที่เกิด
  //    ใน onMutate ซึ่งอยู่ "ก่อน" request ออกจากเบราว์เซอร์ ถ้า reload ทันทีจะ
  //    abort คำขอที่ยังค้าง แล้วเทสจะฟ้องว่าค่าไม่ถูกบันทึกทั้งที่โค้ดทำงานถูก
  const patched = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes(`/pages/${taskId}`),
  )

  const doing = page.getByRole('region', { name: 'กำลังทำ' })
  await doing.getByRole('button', { name: `ย้าย “${TASK}” ไป เสร็จแล้ว` }).click()

  const done = page.getByRole('region', { name: 'เสร็จแล้ว' })
  await expect(done.getByText(TASK)).toBeVisible()

  expect((await patched).status()).toBe(200)

  await page.reload()
  await expect(page.getByRole('region', { name: 'เสร็จแล้ว' }).getByText(TASK)).toBeVisible()
})

test('ฟีดบอกได้ว่าอะไร AI ทำ และกรองเฉพาะที่ AI ทำได้', async ({ page }) => {
  await signIn(page)
  await page.goto('/review?tab=activity')

  const main = page.getByRole('main')

  // เหตุการณ์ที่ AI ทำต้องระบุชื่อผู้ทำและอ่านเป็นภาษาคนได้
  await expect(main.getByText('Claude (AI)').first()).toBeVisible()
  await expect(main.getByText(/เปลี่ยนสถานะจาก .* เป็น /).first()).toBeVisible()
  await expect(main.getByText('เขียนบันทึกความคืบหน้า').first()).toBeVisible()

  // ตัวอย่างข้อความของบันทึกโผล่ในฟีดด้วย
  await expect(main.getByText(NOTE, { exact: false }).first()).toBeVisible()

  // ─── กรอง — เหตุผลหลักที่หน้านี้มีอยู่ ────────────────────────────────────
  await main.getByRole('button', { name: '👤 เฉพาะที่คนทำ' }).click()
  await expect(page).toHaveURL(/actor=human/)
  // เจ้าของยังไม่ได้ทำอะไรนอกจากสร้าง workspace — ไม่ควรเห็นงานของ AI
  await expect(main.getByText('Claude (AI)')).toBeHidden()

  await main.getByRole('button', { name: '🤖 เฉพาะที่ AI ทำ' }).click()
  await expect(page).toHaveURL(/actor=agent/)
  await expect(main.getByText('Claude (AI)').first()).toBeVisible()
})

test('ย้อนสถานะกลับจากฟีดได้', async ({ page }) => {
  await signIn(page)
  await page.goto('/review?tab=activity')

  const main = page.getByRole('main')

  // ─────────────────────────────────────────────────────────────────────
  //  อ่าน "จะย้อนไปเป็นอะไร" จากตัวปุ่มเอง ไม่ใช่เดาจากลำดับเหตุการณ์
  //
  //  ปุ่มย้อนกลับผูกกับ detail.from ของแถวนั้น ๆ ซึ่งขึ้นกับว่าใครทำอะไรไว้ก่อน
  //  การ hardcode ว่า "แถวบนสุดคือ doing → done" ทำให้เทสพังเมื่อมีเหตุการณ์
  //  แทรกเข้ามา ทั้งที่โค้ดทำงานถูก — เคยเขียนแบบนั้นแล้วพลาดมาแล้ว
  // ─────────────────────────────────────────────────────────────────────
  const undo = main.getByRole('button', { name: 'ย้อนกลับ' }).first()
  await expect(undo).toBeVisible()

  const title = await undo.getAttribute('title')
  const target = /เปลี่ยนกลับเป็น (.+)$/.exec(title ?? '')?.[1]
  expect(target, `อ่านสถานะเป้าหมายจาก title ไม่ได้: ${title}`).toBeTruthy()

  const patched = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes(`/pages/${taskId}`),
  )
  await undo.click()
  expect((await patched).status()).toBe(200)

  // ย้อนแล้วบอร์ดต้องแสดงงานในคอลัมน์ที่ปุ่มบอกไว้
  await page.goto('/review')
  await expect(page.getByRole('region', { name: target! }).getByText(TASK)).toBeVisible()
})

test('เจ้าของอ่านบันทึกของ AI และเขียนตอบได้ในหน้าเดียวกัน', async ({ page }) => {
  await signIn(page)
  await page.goto(`/p/${taskId}`)

  const notes = page.getByRole('region', { name: 'บันทึกความคืบหน้า' })
  await expect(notes.getByText(NOTE)).toBeVisible()
  await expect(notes.getByText('Claude (AI)')).toBeVisible()

  const reply = 'รับทราบ เดี๋ยวประสานฝ่ายบัญชีให้ปิดงบเดือนกันยายน'
  await notes.getByLabel('เขียนบันทึกความคืบหน้า').fill(reply)
  await notes.getByRole('button', { name: 'บันทึก' }).click()

  await expect(notes.getByText(reply)).toBeVisible()
  await expect(notes.getByText(owner.name).first()).toBeVisible()

  // เขียนถึงเซิร์ฟเวอร์จริงไหม
  await page.reload()
  await expect(page.getByRole('region', { name: 'บันทึกความคืบหน้า' }).getByText(reply))
    .toBeVisible()
})
