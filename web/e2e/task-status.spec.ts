import { expect, test, type Page } from '@playwright/test'

// ═══════════════════════════════════════════════════════════════════════════
//  สถานะงานต้องมองเห็นและแก้ได้จากหน้าเว็บ
//
//  `pages.status` มีในฐานข้อมูลตั้งแต่ migration AddPageStatus และ MCP เขียนมัน
//  มาตลอด แต่ฝั่งเว็บไม่เคยแสดงเลย: types.ts ไม่มีฟิลด์ status และ pageApi.ts
//  ไม่มีฟังก์ชัน PATCH — งานที่ AI ทำไว้จึงมองไม่เห็นจากหน้าจอ
//
//  เทสนี้พิสูจน์สายทั้งเส้น: PATCH ผ่าน API → PageNodeDto → types.ts →
//  usePageTree → StatusChip โดยเจตนาใช้ "ตั้งค่าผ่าน API แล้วดูที่ UI" ในเคสแรก
//  เพราะนั่นคือสิ่งที่ MCP ทำจริง — เป็นการจำลองว่า AI แก้งานแล้วเจ้าของเห็นไหม
//
//  ⚠️ ต้องรัน API ไว้ที่ :5081 ก่อน (vite dev server proxy /api ไปให้)
// ═══════════════════════════════════════════════════════════════════════════

const stamp = String(Date.now() % 1_000_000)

const account = {
  email: `สถานะ.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'ผู้ตรวจสถานะ',
}

const TASK_TITLE = 'จัดทำรายงานยอดขายประจำไตรมาส'

/** chip ประกาศสถานะไว้ใน aria-label — ไม่พึ่ง emoji ในการค้นหา */
const chip = (page: Page, label: string | RegExp) =>
  page.getByRole('button', { name: label })

test.describe.configure({ mode: 'serial' })

// เก็บไว้ใช้ข้ามเทสใน describe เดียวกัน (mode: serial)
let pageId = ''
let token = ''
let workspaceId = ''

test('สมัคร สร้าง workspace และสร้างหน้าที่จะใช้เป็นงาน', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)

  await page.getByRole('button', { name: 'สมัครสมาชิก' }).last().click()
  await page.getByLabel('ชื่อ').fill(account.name)
  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).first().click()

  await expect(page.getByText('ยังไม่มี workspace')).toBeVisible()

  await page.getByRole('button', { name: /เลือก workspace/ }).click()
  await page.getByText('สร้าง workspace ใหม่').click()
  await page.getByLabel('ชื่อ').fill(`ทีมงาน ${stamp}`)
  await page.getByRole('button', { name: 'สร้าง' }).click()
  await expect(page.getByText(`ทีมงาน ${stamp}`)).toBeVisible()

  await page.getByRole('button', { name: 'หน้าใหม่' }).click()
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/)

  pageId = /\/p\/([0-9a-f-]{36})/.exec(page.url())![1]!

  // พิมพ์ชื่อเรื่องเพื่อให้ projection ตั้ง title ให้ (บรรทัดแรก = ชื่อหน้า)
  await page.getByRole('textbox').last().click()
  await page.keyboard.type(TASK_TITLE)
  await expect(page.getByRole('button', { name: new RegExp(TASK_TITLE) })).toBeVisible({
    timeout: 15_000,
  })

  // ยืม token กับ workspace ที่หน้าเว็บใช้อยู่ ไปยิง API ตรง ๆ ในเคสถัดไป
  // (เลียนแบบสิ่งที่ MCP ทำ — client อื่นที่แก้ข้อมูลชุดเดียวกัน)
  const stored = await page.evaluate(() => ({
    token: window.localStorage.getItem('pm.accessToken'),
    workspace: window.localStorage.getItem('pm.workspaceId'),
  }))

  expect(stored.token, 'ต้องอ่าน access token จาก localStorage ได้').toBeTruthy()
  token = stored.token!
  workspaceId = stored.workspace ?? ''
})

test('ตั้งสถานะผ่าน API แล้ว chip ต้องขึ้นใน sidebar', async ({ page, request }) => {
  const response = await request.patch(`http://localhost:5081/api/v1/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Workspace-Id': workspaceId,
    },
    data: { status: 'doing' },
  })

  expect(response.status(), await response.text()).toBe(200)

  await page.goto('/')

  // นี่คือเคสที่พังมาก่อนหน้านี้: API ส่ง status มาแล้วแต่ฝั่งเว็บทิ้งทั้งฟิลด์
  await expect(chip(page, /กำลังทำ/)).toBeVisible()
})

test('กด chip แล้ววนสถานะ และค่าที่ได้ต้องคงอยู่หลัง refresh', async ({ page }) => {
  await page.goto('/')

  // doing → done
  await chip(page, /กำลังทำ/).click()
  await expect(chip(page, /เสร็จแล้ว/)).toBeVisible()

  // เขียนถึงเซิร์ฟเวอร์จริงไหม — refresh แล้วต้องยังเป็น done
  await page.reload()
  await expect(chip(page, /เสร็จแล้ว/)).toBeVisible()

  // done → (ไม่ใช่งาน) ต้องวนกลับได้ ไม่งั้นหน้าที่เผลอกดจะเป็นงานตลอดกาล
  await chip(page, /เสร็จแล้ว/).click()
  await expect(chip(page, 'ทำเป็นงาน')).toBeVisible()

  await page.reload()
  await expect(chip(page, /เสร็จแล้ว/)).toBeHidden()
})

test('เปลี่ยนแปลงล่าสุดโชว์หน้าที่แก้ไป และกดเข้าไปได้', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'เปลี่ยนแปลงล่าสุด' })).toBeVisible()

  await page.getByRole('button', { name: new RegExp(TASK_TITLE) }).last().click()
  await expect(page).toHaveURL(new RegExp(`/p/${pageId}`))
})

test('ลบแล้วกู้คืนจากถังขยะได้', async ({ page }) => {
  await page.goto('/')

  // ปุ่มลบโผล่ตอน hover — ต้องเอาเมาส์ไปวางบนแถวก่อน
  const row = page.getByRole('button', { name: new RegExp(TASK_TITLE) }).first()
  await row.hover()
  await page.getByRole('button', { name: new RegExp(`ย้าย .* ไปถังขยะ`) }).first().click()

  await expect(page.getByRole('button', { name: new RegExp(TASK_TITLE) })).toBeHidden()

  await page.getByRole('button', { name: 'ถังขยะ' }).click()
  await expect(page).toHaveURL(/\/trash/)
  await expect(page.getByText(TASK_TITLE)).toBeVisible()

  await page.getByRole('button', { name: 'กู้คืน' }).first().click()
  await expect(page.getByText('ถังขยะว่าง')).toBeVisible()

  await page.getByRole('button', { name: 'กลับ' }).click()
  await expect(page.getByRole('button', { name: new RegExp(TASK_TITLE) })).toBeVisible()
})
