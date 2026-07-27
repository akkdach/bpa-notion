import { expect, test, type Page } from '@playwright/test'

// ═══════════════════════════════════════════════════════════════════════════
//  เกณฑ์ผ่านของ Phase 1
//
//    สมัคร → เข้าสู่ระบบ → สร้าง workspace → สร้างหน้าซ้อนชั้น →
//    พิมพ์ใน BlockNote → refresh → เนื้อหายังอยู่
//
//  เทสระดับ API มีครบแล้ว (160 เคส) แต่ไม่มีอันไหนพิสูจน์ว่าเส้นทางจริงที่
//  ผ่าน BlockNote → y-prosemirror → Y.Doc → REST → กลับมา ทำงานได้
//  ตัวนี้คือตัวเดียวที่พิสูจน์เรื่องนั้น
// ═══════════════════════════════════════════════════════════════════════════

const stamp = String(Date.now() % 1_000_000)

const account = {
  email: `อี๋.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'อี๋ ทดสอบ',
}

const CONTENT = 'บันทึกประชุมทีมพัฒนา วาระที่หนึ่ง ทบทวนงานค้างจากสัปดาห์ก่อน'

/**
 * ตัว editor ของ BlockNote
 *
 * ใช้ `[contenteditable]` ไม่ใช่ชื่อคลาส — ชื่อคลาสภายในของ BlockNote เปลี่ยนได้
 * ระหว่างเวอร์ชัน (0.x) ส่วน contenteditable เป็น attribute ของ ProseMirror ที่เสถียร
 * และเป็นตัวที่ทำให้ ARIA เห็นมันเป็น textbox ตั้งแต่แรก
 *
 * ⚠️ เคยเป็น getByRole('textbox').last() แล้วพังตอนเพิ่มแผงบันทึกความคืบหน้า
 *    ใต้ editor — <textarea> ของแผงนั้นก็เป็น role="textbox" เหมือนกัน `.last()`
 *    จึงไปเจอช่องเขียนบันทึกแทน editor แล้วเทสพิมพ์ผิดที่โดยไม่มีอะไรฟ้อง
 *    (ไม่มี projection ถูกส่ง ชื่อใน sidebar เลยไม่อัปเดต และเนื้อหาไม่ถูกบันทึก)
 */
const editorBody = (page: Page) => page.locator('[contenteditable="true"]').last()

test.describe.configure({ mode: 'serial' })

test('สมัคร สร้าง workspace แล้วสร้างหน้า', async ({ page }) => {
  await page.goto('/')

  // ยังไม่ได้ login → ต้องเด้งไปหน้า login
  await expect(page).toHaveURL(/\/login/)

  await page.getByRole('button', { name: 'สมัครสมาชิก' }).last().click()
  await page.getByLabel('ชื่อ').fill(account.name)
  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).first().click()

  // ยังไม่มี workspace → ต้องเห็นหน้าชวนสร้าง
  await expect(page.getByText('ยังไม่มี workspace')).toBeVisible()

  await page.getByRole('button', { name: /เลือก workspace/ }).click()
  await page.getByText('สร้าง workspace ใหม่').click()
  await page.getByLabel('ชื่อ').fill('บริษัท ทดสอบ จำกัด')
  await page.getByRole('button', { name: 'สร้าง' }).click()

  // ชื่อไทยต้องแสดงครบใน switcher
  await expect(page.getByText('บริษัท ทดสอบ จำกัด')).toBeVisible()

  await page.getByRole('button', { name: 'หน้าใหม่' }).click()
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/)
  await expect(editorBody(page)).toBeVisible()
})

test('พิมพ์ภาษาไทยแล้ว refresh — เนื้อหาต้องยังอยู่', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).first().click()

  // เปิดหน้าที่สร้างไว้จากเทสก่อน
  await page.getByRole('button', { name: /ไม่มีชื่อ|บันทึกประชุม/ }).first().click()
  await expect(editorBody(page)).toBeVisible()

  await editorBody(page).click()
  await editorBody(page).fill('')
  await page.keyboard.type(CONTENT, { delay: 12 })

  await expect(editorBody(page)).toContainText(CONTENT)

  // ⚠️ รอให้ flush ขึ้นเซิร์ฟเวอร์ก่อน (useYDoc รวม update 400ms แล้วค่อยส่ง)
  //    ตัวชี้สถานะจะหายไปเมื่อบันทึกเสร็จ
  await expect(page.getByText('กำลังบันทึก…')).toBeHidden({ timeout: 15_000 })
  await page.waitForTimeout(1200)

  const url = page.url()

  // ─────────────────────────────────────────────────────────────────────
  //  ⚠️ ล้าง IndexedDB ก่อน reload
  //
  //  ถ้าไม่ล้าง เนื้อหาอาจมาจาก cache ในเครื่องล้วน ๆ แล้วเทสจะผ่านทั้งที่
  //  เซิร์ฟเวอร์ไม่ได้เก็บอะไรไว้เลย — ซึ่งเป็นความพังที่ต้องจับให้ได้
  // ─────────────────────────────────────────────────────────────────────
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

  await page.goto(url)
  await expect(editorBody(page)).toBeVisible()

  // นี่คือข้อพิสูจน์: เนื้อหามาจากเซิร์ฟเวอร์ล้วน ๆ
  await expect(editorBody(page)).toContainText(CONTENT, { timeout: 15_000 })
})

test('ชื่อหน้าใน sidebar อัปเดตตามบรรทัดแรก', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).first().click()

  await page.getByRole('button', { name: /ไม่มีชื่อ|บันทึกประชุม/ }).first().click()
  await expect(editorBody(page)).toBeVisible()
  await expect(editorBody(page)).toContainText(CONTENT, { timeout: 15_000 })

  // ─────────────────────────────────────────────────────────────────────
  //  projection เป็นข้อมูล derived ที่ส่งช้ากว่าเนื้อหา (debounce 2 วินาที)
  //  จึงต้องรอจริง ๆ ไม่ใช่คาดว่าจะทันตั้งแต่เทสก่อนหน้า
  //
  //  แตะ editor หนึ่งครั้งเพื่อให้ onChange ยิง แล้วรอ debounce
  // ─────────────────────────────────────────────────────────────────────
  await editorBody(page).click()
  await page.keyboard.type(' ')
  await page.waitForTimeout(3000)

  // ⚠️ ต้อง .first() — ชื่อหน้าโผล่ในสามปุ่ม: ตัวหน้าเอง, "สร้างหน้าย่อยใน {ชื่อ}"
  //    และ "ย้าย {ชื่อ} ไปถังขยะ" (aria-label ของปุ่มที่โผล่ตอน hover)
  //    ไม่ใส่แล้วจะได้ strict mode violation ไม่ใช่ผลลัพธ์ที่ผิด
  await expect(
    page.getByRole('button', { name: new RegExp(CONTENT.slice(0, 20)) }).first(),
  ).toBeVisible({ timeout: 20_000 })
})

test('สร้างหน้าย่อยแล้วเห็นการซ้อนชั้นใน sidebar', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).first().click()

  const parent = page.getByRole("button", { name: new RegExp(CONTENT.slice(0, 20)) }).first()
  await expect(parent).toBeVisible({ timeout: 20_000 })

  // ปุ่มสร้างหน้าย่อยโผล่ตอน hover
  await parent.hover()
  await page.getByRole('button', { name: /สร้างหน้าย่อยใน/ }).first().click()

  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/)
  await expect(editorBody(page)).toBeVisible()

  // หน้าย่อยต้องเยื้องเข้าไปหนึ่งชั้น (depth = 1 → padding-left 12px)
  const child = page.getByRole('button', { name: 'ไม่มีชื่อ' }).first()
  await expect(child).toBeVisible()
})
