import { expect, test, type Page } from '@playwright/test'

// ═══════════════════════════════════════════════════════════════════════════
//  เนื้อหาที่เซิร์ฟเวอร์เขียนต้องเปิดใน BlockNote จริงได้ และของเดิมต้องไม่หาย
//
//  scripts/verify-blocknote-append.mjs ตรวจรูปร่างด้วย schema จริงแล้ว แต่มัน
//  ตรวจนอกเบราว์เซอร์ สิ่งที่มันพิสูจน์ไม่ได้คือพฤติกรรมของ y-prosemirror
//  ตอนทำงานจริงกับ editor ที่มีชีวิต:
//
//    · element ที่ผิด schema จะถูก "ลบแล้วกระจายการลบไปทุก client"
//      (sync-plugin จับ throw แล้ว _item.delete()) — เห็นได้เฉพาะตอนมี editor จริง
//    · โครงระดับบนสุดที่ผิดทำให้ tr.replace() throw นอก try/catch แล้ว
//      editor ไม่ render เลย
//
//  ⚠️ เคสสำคัญที่สุดคือ "คนพิมพ์อยู่ก่อน แล้วเซิร์ฟเวอร์เขียนต่อท้าย"
//     ถ้าข้อความของคนหายไปแม้แต่ตัวเดียว = ทำข้อมูลผู้ใช้หายจริง
//
//  ⚠️ ต้องเปิดใน browser context ที่สอง (IndexedDB เย็น) ด้วย — context แรก
//     ถือ Y.Doc ไว้ในหน่วยความจำ ซึ่งอาจกลบอาการ delete-and-propagate ไว้
//
//  ⚠️ ต้องรัน API ไว้ที่ :5081 ก่อน
// ═══════════════════════════════════════════════════════════════════════════

const stamp = String(Date.now() % 1_000_000)
const API = 'http://localhost:5081/api/v1'

const account = {
  email: `เขียนจากเซิร์ฟเวอร์.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'ผู้ทดสอบ',
}

const TYPED = 'บรรทัดที่คนพิมพ์เองกับมือ'
const FROM_SERVER = ['สรุปจาก AI ข้อที่หนึ่ง', 'สรุปจาก AI ข้อที่สอง']

/** editor ของ BlockNote — [contenteditable] เสถียรกว่าชื่อคลาสของ 0.x */
const editorBody = (page: Page) => page.locator('[contenteditable="true"]').last()

test.describe.configure({ mode: 'serial' })

let pageId = ''
let token = ''
let workspaceId = ''

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).first().click()
  await expect(page.getByRole('navigation', { name: 'หน้าทั้งหมด' })).toBeVisible()
}

test('คนพิมพ์เนื้อหาไว้ก่อน', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).last().click()
  await page.getByLabel('ชื่อ').fill(account.name)
  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).first().click()

  await expect(page.getByText('ยังไม่มี workspace')).toBeVisible()
  await page.getByRole('button', { name: /เลือก workspace/ }).click()
  await page.getByText('สร้าง workspace ใหม่').click()
  await page.getByLabel('ชื่อ').fill(`เขียน ${stamp}`)
  await page.getByRole('button', { name: 'สร้าง' }).click()

  await page.getByRole('button', { name: 'หน้าใหม่' }).click()
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/)
  pageId = /\/p\/([0-9a-f-]{36})/.exec(page.url())![1]!

  await editorBody(page).click()
  await page.keyboard.type(TYPED)
  await expect(editorBody(page)).toContainText(TYPED)

  // รอให้ flush ขึ้นเซิร์ฟเวอร์ก่อน ไม่งั้นเซิร์ฟเวอร์จะเขียนทับสถานะที่ยังไม่รู้จัก
  await expect(page.getByText('กำลังบันทึก…')).toBeHidden({ timeout: 15_000 })
  await page.waitForTimeout(1200)

  const stored = await page.evaluate(() => ({
    token: window.localStorage.getItem('pm.accessToken'),
    workspace: window.localStorage.getItem('pm.workspaceId'),
  }))
  token = stored.token!
  workspaceId = stored.workspace!
})

test('เซิร์ฟเวอร์เขียนต่อท้าย แล้วเปิดใน BlockNote จริงได้ครบ', async ({ browser, request }) => {
  const appended = await request.post(`${API}/pages/${pageId}/content/paragraphs`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Id': workspaceId },
    data: { paragraphs: FROM_SERVER },
  })
  expect(appended.status(), await appended.text()).toBe(200)

  // ─────────────────────────────────────────────────────────────────────
  //  browser context ใหม่ = IndexedDB เย็น = เนื้อหาต้องมาจากเซิร์ฟเวอร์ล้วน ๆ
  //
  //  ถ้าใช้ context เดิม Y.Doc ที่อยู่ในหน่วยความจำอาจทำให้ทุกอย่างดูปกติ
  //  ทั้งที่สิ่งที่เก็บไว้จริงพัง
  // ─────────────────────────────────────────────────────────────────────
  const fresh = await browser.newContext({ locale: 'th-TH' })
  const page = await fresh.newPage()

  try {
    await signIn(page)
    await page.goto(`/p/${pageId}`)
    await expect(editorBody(page)).toBeVisible()

    // ⚠️ ข้อความของ "คน" ต้องอยู่ครบ — ถ้าหายคือทำข้อมูลผู้ใช้หายจริง
    await expect(editorBody(page)).toContainText(TYPED, { timeout: 15_000 })

    for (const paragraph of FROM_SERVER) {
      await expect(editorBody(page)).toContainText(paragraph)
    }

    // ─── ย่อหน้าต้องเป็นคนละบล็อก ไม่ใช่ก้อนเดียวติดกัน ────────────────
    const blocks = await page.evaluate(() =>
      [...document.querySelectorAll('[data-node-type="blockContainer"]')]
        .map((element) => element.textContent?.trim() ?? ''))

    expect(blocks.filter((text) => text.length > 0).length).toBeGreaterThanOrEqual(3)
    expect(blocks).toContain(TYPED)
    for (const paragraph of FROM_SERVER) expect(blocks).toContain(paragraph)
  } finally {
    await fresh.close()
  }
})

test('แก้ต่อในเบราว์เซอร์หลังเซิร์ฟเวอร์เขียนแล้ว ยังทำงานปกติ', async ({ page }) => {
  await signIn(page)
  await page.goto(`/p/${pageId}`)
  await expect(editorBody(page)).toContainText(TYPED, { timeout: 15_000 })

  const extra = 'พิมพ์ต่อหลังจาก AI เขียนแล้ว'

  // คลิกท้ายเอกสารแล้วพิมพ์ต่อ — พิสูจน์ว่า editor ยังแก้ได้จริง ไม่ได้ค้าง
  await editorBody(page).click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(extra)

  await expect(editorBody(page)).toContainText(extra)
  await expect(page.getByText('กำลังบันทึก…')).toBeHidden({ timeout: 15_000 })
  await page.waitForTimeout(1200)

  // ล้าง IndexedDB แล้วโหลดใหม่ — เนื้อหาทั้งสามแหล่งต้องอยู่ครบ
  await page.evaluate(async () => {
    const databases = await indexedDB.databases()
    await Promise.all(
      databases
        .filter((db) => db.name?.startsWith('pm-page-'))
        .map((db) => new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(db.name!)
          request.onsuccess = resolve
          request.onerror = resolve
          request.onblocked = resolve
        })),
    )
  })

  await page.reload()
  await expect(editorBody(page)).toContainText(TYPED, { timeout: 15_000 })
  await expect(editorBody(page)).toContainText(FROM_SERVER[0])
  await expect(editorBody(page)).toContainText(extra)
})
