import { expect, test, type Page } from '@playwright/test'

// ═══════════════════════════════════════════════════════════════════════════
//  หน้าตั้งค่า
//
//  เทสระดับ API พิสูจน์ไม่ได้ว่าเมนูกดติด — และเมนูของ @base-ui/react เคยกดไม่ติด
//  มาแล้วครั้งหนึ่งเพราะใช้ onSelect แทน onClick โดย TypeScript ไม่ฟ้อง
//  (ดู WorkspaceSwitcher.tsx) เทสนี้จึงเดินผ่านเมนูจริงทุกครั้ง ไม่ goto ตรง
// ═══════════════════════════════════════════════════════════════════════════

const stamp = String(Date.now() % 1_000_000)

const owner = {
  email: `เจ้าของ.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'เจ้าของ workspace',
}

const guest = {
  email: `สมาชิก.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'สมาชิกใหม่',
}

const WORKSPACE = `ทีมตั้งค่า ${stamp}`

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

  // ⚠️ ต้องรอให้ออกจากหน้า login ก่อน goto ที่อื่น
  //    การกดปุ่มเริ่ม request แบบ async ถ้า goto ทันที RequireAuth จะเห็นว่า
  //    ยังไม่มี user แล้วเด้งกลับมา /login — อาการคือเทสล้มที่บรรทัดถัดไป
  //    โดยหน้าจอเป็นฟอร์ม login เปล่า ๆ ซึ่งดูเหมือน "รหัสผ่านผิด"
  await expect(page).not.toHaveURL(/\/login/)
}

test('สมัครสมาชิกคนที่สองไว้ใช้ทดสอบการเพิ่มสมาชิก', async ({ page }) => {
  await register(page, guest)
  await expect(page.getByText('ยังไม่มี workspace')).toBeVisible()
})

test('เปิดหน้าตั้งค่าจากเมนูได้', async ({ page }) => {
  await register(page, owner)

  await page.getByRole('button', { name: /เลือก workspace/ }).click()
  await page.getByText('สร้าง workspace ใหม่').click()
  await page.getByLabel('ชื่อ').fill(WORKSPACE)
  await page.getByRole('button', { name: 'สร้าง' }).click()
  await expect(page.getByText(WORKSPACE)).toBeVisible()

  // เดินผ่านเมนูจริง ไม่ goto ตรง — นี่คือสิ่งที่เทสนี้มีไว้พิสูจน์
  await page.getByRole('button', { name: new RegExp(WORKSPACE) }).click()
  await page.getByText('ตั้งค่า', { exact: true }).click()

  await expect(page).toHaveURL(/\/settings/)
  await expect(page.getByRole('heading', { name: 'workspace', exact: true })).toBeVisible()
  await expect(page.getByText(`สิทธิ์ของคุณที่นี่: เจ้าของ`)).toBeVisible()
})

test('เปลี่ยนชื่อ workspace แล้วชื่อในแถบข้างเปลี่ยนตาม', async ({ page }) => {
  await login(page, owner)
  await page.goto('/settings/workspace')

  const renamed = `${WORKSPACE} แก้แล้ว`
  // exact: true — ไม่ใส่แล้วจับ 'ชื่อสำหรับ URL' ด้วย ได้ strict mode violation
  await page.getByLabel('ชื่อ', { exact: true }).fill(renamed)
  await page.getByRole('button', { name: 'บันทึก' }).click()
  await expect(page.getByText('บันทึกแล้ว')).toBeVisible()

  // ⚠️ ชื่อใน switcher มาจาก AuthProvider ไม่ใช่ query ของหน้านี้
  //    ถ้าลืม refreshWorkspaces() ผู้ใช้จะเห็นชื่อเก่าค้างจนกว่าจะ reload
  await page.getByRole('button', { name: 'กลับ' }).click()
  await expect(page.getByText(renamed)).toBeVisible()
})

test('เพิ่มสมาชิกด้วยอีเมล เปลี่ยนสิทธิ์ แล้วถอดออก', async ({ page }) => {
  await login(page, owner)
  await page.goto('/settings/members')

  await expect(page.getByRole('heading', { name: 'สมาชิก' })).toBeVisible()

  await page.getByLabel('อีเมล').fill(guest.email)
  await page.getByRole('button', { name: 'เพิ่ม' }).click()

  const row = page.locator('li').filter({ hasText: guest.email })
  await expect(row).toBeVisible()

  // เปลี่ยนสิทธิ์เป็นผู้ดูแล
  await page.getByRole('button', { name: `เปลี่ยนสิทธิ์ของ ${guest.name}` }).click()
  await page.getByRole('menuitem', { name: 'ผู้ดูแล' }).click()
  await expect(row.getByText('ผู้ดูแล')).toBeVisible()

  await page.getByRole('button', { name: `ถอด ${guest.name} ออกจาก workspace` }).click()
  await expect(page.locator('li').filter({ hasText: guest.email })).toHaveCount(0)
})

test('สลับเป็นโหมดมืดแล้วมีผลจริง และจำได้หลัง reload', async ({ page }) => {
  await login(page, owner)
  await page.goto('/settings/appearance')

  const html = page.locator('html')
  await expect(html).not.toHaveClass(/dark/)

  await page.getByRole('radio', { name: 'มืด' }).click()

  // พิสูจน์ว่ามีผลจริง ไม่ใช่แค่ปุ่มเปลี่ยนสี
  await expect(html).toHaveClass(/dark/)
  await expect(page.getByRole('radio', { name: 'มืด' })).toHaveAttribute('aria-checked', 'true')

  await page.reload()
  await expect(html).toHaveClass(/dark/)

  await page.getByRole('radio', { name: 'สว่าง' }).click()
  await expect(html).not.toHaveClass(/dark/)
})

test('สมาชิกธรรมดาแก้ workspace ไม่ได้', async ({ page }) => {
  // เพิ่ม guest กลับเข้ามาเป็น member ก่อน
  await login(page, owner)
  await page.goto('/settings/members')
  await page.getByLabel('อีเมล').fill(guest.email)
  await page.getByRole('button', { name: 'เพิ่ม' }).click()
  await expect(page.locator('li').filter({ hasText: guest.email })).toBeVisible()

  await page.getByRole('button', { name: 'กลับ' }).click()
  await page.getByRole('button', { name: new RegExp(WORKSPACE) }).click()
  await page.getByText('ออกจากระบบ').click()

  // ⚠️ รอให้ออกจากระบบเสร็จก่อน — logout เป็น async (ยิง revoke ขึ้นเซิร์ฟเวอร์
  //    แล้วค่อย navigate) ถ้า login() ทำ goto('/') ทันทีจะยังมี session อยู่
  //    แล้วได้หน้าแอปไม่ใช่ฟอร์ม login
  await expect(page).toHaveURL(/\/login/)

  await login(page, guest)
  await page.goto('/settings/workspace')

  await expect(page.getByText('ต้องเป็นเจ้าของหรือผู้ดูแลจึงจะแก้ไขได้')).toBeVisible()
  await expect(page.getByRole('button', { name: 'บันทึก' })).toHaveCount(0)

  // ฟอร์มเพิ่มสมาชิกต้องไม่โผล่ให้คนที่ไม่มีสิทธิ์เลย
  await page.goto('/settings/members')
  await expect(page.getByRole('button', { name: 'เพิ่ม' })).toHaveCount(0)
})
