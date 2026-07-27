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
//
//  ⚠️ ชื่อหน้าโผล่ใน aria-label ของปุ่ม + และปุ่มถังขยะด้วย ("สร้างหน้าย่อยใน X",
//     "ย้าย X ไปถังขยะ") การหาด้วย regex ของชื่อเฉย ๆ จึงเจอสามปุ่มแล้ว strict
//     mode ฟ้อง — ต้อง scope ด้วย region และใช้ exact เมื่อหาแถวในต้นไม้
// ═══════════════════════════════════════════════════════════════════════════

const stamp = String(Date.now() % 1_000_000)

const account = {
  email: `สถานะ.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'ผู้ตรวจสถานะ',
}

const TASK_TITLE = 'จัดทำรายงานยอดขายประจำไตรมาส'

/** แถบด้านข้าง — AppShell ตั้ง aria-label ไว้ที่ <nav> */
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'หน้าทั้งหมด' })

/** แถวของหน้าใน sidebar — exact เพื่อไม่ให้ชนกับปุ่ม + และปุ่มลบที่มีชื่อหน้าใน aria-label */
const treeRow = (page: Page, title: string) =>
  sidebar(page).getByRole('button', { name: title, exact: true })

/** chip ประกาศสถานะไว้ใน aria-label — ไม่พึ่ง emoji ในการค้นหา */
const chip = (page: Page, label: string | RegExp) =>
  sidebar(page).getByRole('button', { name: label })

/**
 * เข้าสู่ระบบใหม่ทุกเทส
 *
 * ⚠️ mode: 'serial' บังคับแค่ "ลำดับ" กับ "หยุดเมื่อเจอตัวแรกที่ล้ม" — มันไม่ได้
 *    แชร์ browser context ให้ แต่ละเทสจึงได้ localStorage เปล่า = ไม่ได้ล็อกอิน
 *    (phase1-walking-skeleton.spec.ts ก็ล็อกอินซ้ำทุกเทสด้วยเหตุผลเดียวกัน)
 */
async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).first().click()
  await expect(sidebar(page)).toBeVisible()
}

/** token กับ workspace ที่หน้าเว็บใช้อยู่ — ใช้ยิง API ตรง ๆ เลียนแบบ MCP */
async function credentials(page: Page) {
  const stored = await page.evaluate(() => ({
    token: window.localStorage.getItem('pm.accessToken'),
    workspace: window.localStorage.getItem('pm.workspaceId'),
  }))

  expect(stored.token, 'ต้องอ่าน access token จาก localStorage ได้').toBeTruthy()
  expect(stored.workspace, 'ต้องมี workspace ที่เลือกอยู่').toBeTruthy()

  return { token: stored.token!, workspaceId: stored.workspace! }
}

test.describe.configure({ mode: 'serial' })

// id ของหน้าที่สร้างในเทสแรก — ส่งต่อได้เพราะ mode: serial รับประกันลำดับ
let pageId = ''

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
  // debounce 2 วินาทีใน useYDoc + round-trip → รอได้นานกว่าปกติ
  // ⚠️ ต้องเจาะจง [contenteditable] ไม่ใช่ getByRole('textbox') — แผงบันทึก
  //    ความคืบหน้าใต้ editor มี <textarea> ที่เป็น role="textbox" เหมือนกัน
  await page.locator('[contenteditable="true"]').last().click()
  await page.keyboard.type(TASK_TITLE)
  await expect(treeRow(page, TASK_TITLE)).toBeVisible({ timeout: 15_000 })
})

test('ตั้งสถานะผ่าน API แล้ว chip ต้องขึ้นใน sidebar', async ({ page, request }) => {
  await signIn(page)
  const { token, workspaceId } = await credentials(page)

  // ยิง API ตรง ๆ เลียนแบบสิ่งที่ MCP ทำ — client อื่นที่แก้ข้อมูลชุดเดียวกัน
  const response = await request.patch(`http://localhost:5081/api/v1/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Workspace-Id': workspaceId,
    },
    data: { status: 'doing' },
  })

  expect(response.status(), await response.text()).toBe(200)

  await page.reload()

  // นี่คือเคสที่พังมาก่อนหน้านี้: API ส่ง status มาแล้วแต่ฝั่งเว็บทิ้งทั้งฟิลด์
  await expect(chip(page, /กำลังทำ/)).toBeVisible()
})

test('กด chip แล้ววนสถานะ และค่าที่ได้ต้องคงอยู่หลัง refresh', async ({ page }) => {
  await signIn(page)

  /**
   * กด chip แล้วรอให้ PATCH ตอบกลับก่อน
   *
   * ⚠️ ห้าม reload ทันทีหลัง assertion ว่า chip เปลี่ยนแล้ว — chip เปลี่ยนจาก
   *    optimistic update ซึ่งเกิดใน onMutate "ก่อน" request ออกจากเบราว์เซอร์
   *    reload ตรงนั้นจะ abort PATCH ที่ยังค้างอยู่ แล้วเทสจะฟ้องว่าค่าไม่ถูกบันทึก
   *    ทั้งที่โค้ดทำงานถูก (เจอมาแล้วตอนเขียนเทสนี้)
   */
  const cycle = async (from: RegExp, to: string | RegExp) => {
    const patched = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().includes(`/pages/${pageId}`),
    )

    await chip(page, from).click()
    await expect(chip(page, to)).toBeVisible()

    const response = await patched
    expect(response.status(), await response.text()).toBe(200)
  }

  // doing → done
  await cycle(/กำลังทำ/, /เสร็จแล้ว/)

  // เขียนถึงเซิร์ฟเวอร์จริงไหม — refresh แล้วต้องยังเป็น done
  await page.reload()
  await expect(chip(page, /เสร็จแล้ว/)).toBeVisible()

  // done → (ไม่ใช่งาน) ต้องวนกลับได้ ไม่งั้นหน้าที่เผลอกดจะเป็นงานตลอดกาล
  await cycle(/เสร็จแล้ว/, 'ทำเป็นงาน')

  await page.reload()
  await expect(chip(page, /เสร็จแล้ว/)).toBeHidden()
  // หน้าที่ไม่ใช่งานแล้ว chip ต้องยังกดได้อยู่ (โชว์ตอน hover)
  await expect(chip(page, 'ทำเป็นงาน')).toBeAttached()
})

test('เปลี่ยนแปลงล่าสุดโชว์หน้าที่แก้ไป และกดเข้าไปได้', async ({ page }) => {
  await signIn(page)

  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: 'เปลี่ยนแปลงล่าสุด' })).toBeVisible()

  // ชื่อปุ่มในฟีดมีเวลาต่อท้าย ("… เมื่อสักครู่") จึงใช้ regex ไม่ใช่ exact
  await main.getByRole('button', { name: new RegExp(TASK_TITLE) }).first().click()
  await expect(page).toHaveURL(new RegExp(`/p/${pageId}`))
})

test('ลบแล้วกู้คืนจากถังขยะได้', async ({ page }) => {
  await signIn(page)

  // ปุ่มลบโผล่ตอน hover — ต้องเอาเมาส์ไปวางบนแถวก่อน
  await treeRow(page, TASK_TITLE).hover()
  await sidebar(page)
    .getByRole('button', { name: `ย้าย ${TASK_TITLE} ไปถังขยะ` })
    .click()

  await expect(treeRow(page, TASK_TITLE)).toBeHidden()

  await page.getByRole('button', { name: 'ถังขยะ' }).click()
  await expect(page).toHaveURL(/\/trash/)

  const main = page.getByRole('main')
  await expect(main.getByText(TASK_TITLE)).toBeVisible()

  await main.getByRole('button', { name: 'กู้คืน' }).first().click()
  await expect(main.getByText('ถังขยะว่าง')).toBeVisible()

  await page.getByRole('button', { name: 'กลับ' }).click()
  await expect(treeRow(page, TASK_TITLE)).toBeVisible()
})
