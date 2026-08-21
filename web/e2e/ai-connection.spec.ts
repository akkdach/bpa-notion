import { expect, test, type Page } from '@playwright/test'

// ═══════════════════════════════════════════════════════════════════════════
//  ลูกค้าเอา token มาจากไหน
//
//  คำถามแรกของทุกคนที่จะต่อ AI เข้ามาคือ "แล้วผมเอา token มาจากไหน" คำตอบที่
//  คู่มือ (docs/RB-connect-ai.md) ให้ไว้คือ "กดสร้างในหน้าตั้งค่า" — เทสนี้มีไว้
//  พิสูจน์ว่าคำตอบนั้นเป็นจริงในเบราว์เซอร์ ไม่ใช่จริงแค่ที่ระดับ API
//
//  ⚠️ เคสตัดสินคือ "แสดงค่าจริงครั้งเดียว" — ฐานข้อมูลเก็บแค่ SHA-256 ถ้าวันหนึ่ง
//     มีคนทำให้ค่าจริงกลับมาอ่านได้อีก เทสนี้ต้องแดง
//
//  ⚠️ ต้องรัน API ไว้ที่ :5081 ก่อน
// ═══════════════════════════════════════════════════════════════════════════

const stamp = String(Date.now() % 1_000_000)
const password = 'รหัสผ่านยาวพอสมควรนะครับ'

const owner = {
  email: `เจ้าของโทเคน.${stamp}@ทดสอบ.local`,
  password,
  name: 'เจ้าของงาน',
}

const member = {
  email: `สมาชิกโทเคน.${stamp}@ทดสอบ.local`,
  password,
  name: 'สมาชิกธรรมดา',
}

const WORKSPACE = `ทีมเชื่อม AI ${stamp}`
const TOKEN_NAME = `โน้ตบุ๊กสมชาย ${stamp}`

test.describe.configure({ mode: 'serial' })

async function register(page: Page, account: typeof owner) {
  await page.goto('/')
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).last().click()
  await page.getByLabel('ชื่อ').fill(account.name)
  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).first().click()
}

async function login(page: Page, account: typeof owner) {
  await page.goto('/')
  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).first().click()
  await expect(page).not.toHaveURL(/\/login/)
}

test('เตรียมบัญชี: สมาชิกธรรมดาไว้ทดสอบสิทธิ์', async ({ page }) => {
  await register(page, member)
  await expect(page.getByText('ยังไม่มี workspace')).toBeVisible()
})

test('เจ้าของสร้าง token ได้จากหน้าตั้งค่า และเห็นค่าจริงครั้งเดียว', async ({ page }) => {
  await register(page, owner)

  await page.getByRole('button', { name: /เลือก workspace/ }).click()
  await page.getByText('สร้าง workspace ใหม่').click()
  await page.getByLabel('ชื่อ').fill(WORKSPACE)
  await page.getByRole('button', { name: 'สร้าง' }).click()
  await expect(page.getByText(WORKSPACE)).toBeVisible()

  // เดินผ่านเมนูจริง — เทสนี้พิสูจน์เส้นทางที่ลูกค้าเดิน ไม่ใช่แค่ว่า route มีอยู่
  await page.getByRole('button', { name: new RegExp(WORKSPACE) }).click()
  await page.getByText('ตั้งค่า', { exact: true }).click()
  await page.getByRole('button', { name: 'การเชื่อมต่อ AI' }).click()

  await expect(page).toHaveURL(/\/settings\/ai/)
  await expect(page.getByRole('heading', { name: 'การเชื่อมต่อ AI' })).toBeVisible()
  await expect(page.getByText('ยังไม่มี token')).toBeVisible()

  await page.getByLabel('ชื่อ token').fill(TOKEN_NAME)
  await page.getByRole('button', { name: 'ไม่มีวันหมดอายุ' }).click()
  await page.getByRole('button', { name: 'สร้าง token' }).click()

  // ค่าจริงต้องอยู่บนจอให้คัดลอกได้ และต้องเป็นของจริง ไม่ใช่ placeholder
  const shown = page.getByLabel('ค่า token ที่เพิ่งสร้าง')
  await expect(shown).toBeVisible()
  const value = (await shown.innerText()).trim()
  expect(value).toMatch(/^pmt_/)
  expect(value.length).toBeGreaterThanOrEqual(40)

  await expect(page.getByText('ออกจากหน้านี้แล้วจะดูค่านี้อีกไม่ได้')).toBeVisible()

  const row = page.locator('li').filter({ hasText: TOKEN_NAME })
  await expect(row).toBeVisible()
  await expect(row.getByText(`…${value.slice(-4)}`)).toBeVisible()
  await expect(row.getByText('ยังไม่เคยถูกใช้')).toBeVisible()

  // ─────────────────────────────────────────────────────────────────────
  //  เคสตัดสิน: reload แล้วค่าจริงต้องหายไปจากหน้าจอทั้งหน้า
  //
  //  ไม่ใช่แค่ "กล่องเขียวหายไป" — assert กับ body ทั้งก้อน เพราะถ้าวันหนึ่ง
  //  มีคนเผลอใส่ Token กลับเข้าไปใน DTO ของ list ค่าจริงจะโผล่ที่อื่นในหน้า
  //  โดยที่กล่องเขียวยังหายไปตามปกติ
  // ─────────────────────────────────────────────────────────────────────
  await page.reload()
  await expect(row).toBeVisible()
  await expect(page.locator('body')).not.toContainText(value)
})

test('เพิกถอนแล้วสถานะเปลี่ยนและปุ่มหายไป', async ({ page }) => {
  await login(page, owner)
  await page.goto('/settings/ai')

  const row = page.locator('li').filter({ hasText: TOKEN_NAME })
  await page.getByRole('button', { name: `เพิกถอน ${TOKEN_NAME}` }).click()

  await expect(row.getByText('เพิกถอนแล้ว')).toBeVisible()
  await expect(page.getByRole('button', { name: `เพิกถอน ${TOKEN_NAME}` })).toHaveCount(0)

  // ยังอยู่ในรายการ ไม่ได้หายไป — ประวัติว่าเคยออกใบให้ใครต้องอ่านย้อนหลังได้
  await page.reload()
  await expect(row).toBeVisible()
})

test('สมาชิกธรรมดาไม่เห็นเครื่องมือออก token', async ({ page }) => {
  await login(page, owner)
  await page.goto('/settings/members')
  await page.getByLabel('อีเมล').fill(member.email)
  await page.getByRole('button', { name: 'เพิ่ม' }).click()
  await expect(page.locator('li').filter({ hasText: member.email })).toBeVisible()

  await page.getByRole('button', { name: 'กลับ' }).click()
  await page.getByRole('button', { name: new RegExp(WORKSPACE) }).click()
  await page.getByText('ออกจากระบบ').click()
  await expect(page).toHaveURL(/\/login/)

  await login(page, member)
  await page.goto('/settings/ai')

  await expect(page.getByText('ต้องเป็นเจ้าของหรือผู้ดูแลจึงจะออก token ได้')).toBeVisible()
  await expect(page.getByRole('button', { name: 'สร้าง token' })).toHaveCount(0)
})
