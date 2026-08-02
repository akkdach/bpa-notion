import { expect, test, type Page } from '@playwright/test'

// ═══════════════════════════════════════════════════════════════════════════
//  markdown ที่ AI เขียนต้องขึ้นเป็นเอกสารที่ดูรู้เรื่อง และ ```mermaid ต้องเป็น
//  แผนภาพจริง
//
//  scripts/verify-blocknote-append.mjs พิสูจน์รูปร่างของเอกสารไปแล้วด้วย schema
//  จริง สิ่งที่มันพิสูจน์ไม่ได้คือ:
//
//    · หัวข้อ level "2" (สตริง เพราะ Yjs เขียน attribute ได้แค่สตริง) ขึ้นเป็น
//      <h2> จริงหรือไม่ — ProseMirror ไม่ validate ชนิดของ attribute
//      node.check() จึงผ่านทั้งที่อาจ render เป็น <h1> หมด
//    · mermaid วาดออกมาเป็นภาพจริงไหม
//
//  ⚠️ การพิสูจน์ว่า "แผนภาพขึ้นจริง" ต้องไม่ใช่แค่ "มี <svg>" — svg เปล่า ๆ
//     ปลอมได้ง่าย เคสตัดสินคือ svg ต้องมี "ข้อความไทยจากซอร์สของเราเอง"
//
//  ⚠️ ต้องรัน API ไว้ที่ :5081 ก่อน
// ═══════════════════════════════════════════════════════════════════════════

const stamp = String(Date.now() % 1_000_000)
const API = 'http://localhost:5081/api/v1'

const account = {
  email: `มาร์กดาวน์.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'ผู้ทดสอบมาร์กดาวน์',
}

const TYPED = 'บรรทัดที่คนพิมพ์เองกับมือ'

// ป้ายในผังงานเป็นภาษาไทย — เป็นตัวพิสูจน์ว่า mermaid อ่านซอร์ส "ของเรา" จริง
const NODE_START = 'เริ่มงาน'
const NODE_DONE = 'ปิดงานเรียบร้อย'

const MARKDOWN = [
  '# รายงานประจำสัปดาห์',
  '',
  '## ขั้นตอนอนุมัติ',
  '',
  '- ตรวจสอบยอดขาย',
  '- ปิดงบเดือน',
  '',
  '- [x] เก็บข้อมูลครบแล้ว',
  '- [ ] ยังไม่ได้สรุป',
  '',
  '> ข้อมูลจากระบบบัญชีอาจคลาดเคลื่อน',
  '',
  '```mermaid',
  'graph TD',
  `  A[${NODE_START}] --> B[ตรวจสอบ]`,
  `  B --> C[${NODE_DONE}]`,
  '```',
  '',
  '---',
  '',
].join('\n')

const AFTER_BROKEN = 'ย่อหน้าหลังผังงานที่พัง'

const BROKEN_MARKDOWN = [
  '```mermaid',
  'graph TD',
  '  A[[[ อันนี้พัง --> ))',
  '```',
  '',
  AFTER_BROKEN,
  '',
].join('\n')

const editorBody = (page: Page) => page.locator('[contenteditable="true"]').last()

test.describe.configure({ mode: 'serial' })

let token = ''
let workspaceId = ''
let pageId = ''
let brokenPageId = ''

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).first().click()
  await expect(page.getByRole('navigation', { name: 'หน้าทั้งหมด' })).toBeVisible()
}

test('เตรียมหน้า และคนพิมพ์เนื้อหาไว้ก่อน', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).last().click()
  await page.getByLabel('ชื่อ').fill(account.name)
  await page.getByLabel('อีเมล').fill(account.email)
  await page.getByLabel('รหัสผ่าน').fill(account.password)
  await page.getByRole('button', { name: 'สมัครสมาชิก' }).first().click()

  await expect(page.getByText('ยังไม่มี workspace')).toBeVisible()
  await page.getByRole('button', { name: /เลือก workspace/ }).click()
  await page.getByText('สร้าง workspace ใหม่').click()
  await page.getByLabel('ชื่อ').fill(`มาร์กดาวน์ ${stamp}`)
  await page.getByRole('button', { name: 'สร้าง' }).click()

  await page.getByRole('button', { name: 'หน้าใหม่' }).click()
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/)
  pageId = /\/p\/([0-9a-f-]{36})/.exec(page.url())![1]!

  await editorBody(page).click()
  await page.keyboard.type(TYPED)
  await expect(editorBody(page)).toContainText(TYPED)

  await expect(page.getByText('กำลังบันทึก…')).toBeHidden({ timeout: 15_000 })
  await page.waitForTimeout(1200)

  const stored = await page.evaluate(() => ({
    token: window.localStorage.getItem('pm.accessToken'),
    workspace: window.localStorage.getItem('pm.workspaceId'),
  }))
  token = stored.token!
  workspaceId = stored.workspace!
})

test('AI เขียน markdown แล้วขึ้นเป็นบล็อกที่ถูกชนิดในเบราว์เซอร์จริง', async ({ browser, request }) => {
  const appended = await request.post(`${API}/pages/${pageId}/content/markdown`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Id': workspaceId },
    data: { markdown: MARKDOWN },
  })
  expect(appended.status(), await appended.text()).toBe(200)

  // browser context ใหม่ = IndexedDB เย็น = เนื้อหาต้องมาจากเซิร์ฟเวอร์ล้วน ๆ
  const fresh = await browser.newContext({ locale: 'th-TH' })
  const page = await fresh.newPage()

  try {
    await signIn(page)
    await page.goto(`/p/${pageId}`)
    await expect(editorBody(page)).toBeVisible()

    // ⚠️ ข้อความของ "คน" ต้องอยู่ครบ — ถ้าหายคือทำข้อมูลผู้ใช้หายจริง
    await expect(editorBody(page)).toContainText(TYPED, { timeout: 15_000 })

    // ─── ชนิดบล็อกต้องถูก ไม่ใช่ย่อหน้าที่มี # นำหน้า ────────────────────
    // data-content-type มาจาก wrapInBlockStructure ของ BlockNote เอง
    await expect(page.locator('[data-content-type="heading"]')).toHaveCount(2)
    await expect(page.locator('[data-content-type="bulletListItem"]')).toHaveCount(2)
    await expect(page.locator('[data-content-type="checkListItem"]')).toHaveCount(2)
    await expect(page.locator('[data-content-type="quote"]')).toHaveCount(1)
    await expect(page.locator('[data-content-type="divider"]')).toHaveCount(1)

    // ⚠️ เคสที่ oracle นอกเบราว์เซอร์จับไม่ได้: level มาเป็นสตริง "2"
    //    ProseMirror ไม่ validate ชนิดของ attribute — ถ้า BlockNote ไม่ยอมรับ
    //    สตริง ทุกหัวข้อจะกลายเป็น <h1> โดยที่ node.check() ยังผ่าน
    // ⚠️ ต้อง scope ไว้ใน editor — แผงบันทึกใต้เอกสารก็มี <h2> ของตัวเอง
    //    ("บันทึกความคืบหน้า") ซึ่งทำให้ strict mode ฟ้องว่าเจอสองตัว
    await expect(editorBody(page).locator('h1')).toContainText('รายงานประจำสัปดาห์')
    await expect(editorBody(page).locator('h2')).toContainText('ขั้นตอนอนุมัติ')

    // - [x] ต้องติ๊ก และ - [ ] ต้องไม่ติ๊ก
    // (เขียน checked="false" เมื่อไหร่ ข้อนี้แดงทันที — "false" เป็นสตริง truthy)
    await expect(page.locator('[data-content-type="checkListItem"] input:checked'))
      .toHaveCount(1)
  } finally {
    await fresh.close()
  }
})

test('```mermaid ขึ้นเป็นแผนภาพจริง ไม่ใช่แค่บล็อกโค้ด', async ({ browser }) => {
  const fresh = await browser.newContext({ locale: 'th-TH' })
  const page = await fresh.newPage()

  try {
    await signIn(page)
    await page.goto(`/p/${pageId}`)
    await expect(editorBody(page)).toBeVisible()

    const diagram = page.locator('.bn-mermaid svg')

    // 1. มีจริงและมีขนาดจริง — placeholder ไม่มีขนาด
    await expect(diagram).toBeVisible({ timeout: 20_000 })
    const box = await diagram.boundingBox()
    expect(box!.width).toBeGreaterThan(80)
    expect(box!.height).toBeGreaterThan(40)

    // ─────────────────────────────────────────────────────────────────
    //  2. ⚠️ เคสตัดสิน — svg ต้องมีป้ายภาษาไทยจากซอร์สของเราเอง
    //
    //     "มี <svg>" อย่างเดียวปลอมได้ด้วย element เปล่า ๆ แต่ svg ที่มีคำว่า
    //     "เริ่มงาน" อยู่ข้างในแปลว่า mermaid อ่านซอร์สของเราแล้ววาดจริง
    // ─────────────────────────────────────────────────────────────────
    await expect(diagram).toContainText(NODE_START)
    await expect(diagram).toContainText(NODE_DONE)

    // 3. ซอร์สถูกซ่อน ไม่แสดงคู่กับแผนภาพ
    await expect(
      page.locator('[data-content-type="codeBlock"][data-language="mermaid"]'),
    ).toBeHidden()

    // 4. ไม่ใช่สถานะผิดพลาด
    await expect(page.locator('.bn-mermaid-error')).toHaveCount(0)

    // ─── สลับไปดูซอร์สแล้วกลับมาได้ ────────────────────────────────────
    await page.locator('.bn-mermaid').hover()
    await page.getByRole('button', { name: 'ดูซอร์สของผังงาน' }).click()
    await expect(
      page.locator('[data-content-type="codeBlock"][data-language="mermaid"]'),
    ).toBeVisible()

    // ⚠️ ต้องกลับมาได้ ไม่งั้นผู้ใช้ติดอยู่กับมุมมองซอร์สจนกว่าจะ reload
    await page.getByRole('button', { name: 'กลับไปดูแผนภาพ' }).click()
    await expect(page.locator('.bn-mermaid svg')).toBeVisible()
  } finally {
    await fresh.close()
  }
})

test('mermaid ที่ไวยากรณ์พังต้องไม่ทำให้เอกสารใช้งานไม่ได้', async ({ browser, request }) => {
  const created = await request.post(`${API}/pages`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Id': workspaceId },
    data: { parentId: null, title: `ผังงานพัง ${stamp}` },
  })
  expect(created.status(), await created.text()).toBe(201)
  brokenPageId = ((await created.json()) as { data: { id: string } }).data.id

  const appended = await request.post(`${API}/pages/${brokenPageId}/content/markdown`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Id': workspaceId },
    data: { markdown: BROKEN_MARKDOWN },
  })
  expect(appended.status(), await appended.text()).toBe(200)

  const fresh = await browser.newContext({ locale: 'th-TH' })
  const page = await fresh.newPage()

  try {
    await signIn(page)
    await page.goto(`/p/${brokenPageId}`)
    await expect(editorBody(page)).toBeVisible()

    // เห็นว่าพัง และเห็นซอร์สเพื่อไปแก้ได้ — ไม่ใช่กล่องเปล่า
    await expect(page.locator('.bn-mermaid-error')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.bn-mermaid-error')).toContainText('graph TD')

    // ─────────────────────────────────────────────────────────────────
    //  ⚠️ ข้อนี้คือเหตุผลที่ renderInto ห้าม throw ออกจาก toDOM
    //     ถ้ามันโยนออกมา ProseMirror จะหยุด render ทั้งเอกสาร แล้วผู้ใช้
    //     พิมพ์อะไรไม่ได้เลยเพราะ AI เขียนผังงานผิดไปหนึ่งอัน
    //
    //     ⚠️ ต้องคลิกที่ "ย่อหน้า" ไม่ใช่ที่ท้ายเอกสารเฉย ๆ — ถ้าเคอร์เซอร์ไป
    //        ตกในบล็อกโค้ด Enter จะขึ้นบรรทัดใหม่ "ในโค้ด" แล้วข้อความที่พิมพ์
    //        จะถูกซ่อนไปกับซอร์ส ซึ่งเป็นพฤติกรรมที่ถูกแล้วแต่ทดสอบผิดเรื่อง
    // ─────────────────────────────────────────────────────────────────
    const paragraph = page.locator('[data-content-type="paragraph"]')
      .filter({ hasText: AFTER_BROKEN }).first()
    await expect(paragraph).toBeVisible()
    await paragraph.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' ยังพิมพ์ต่อได้อยู่')
    await expect(paragraph).toContainText('ยังพิมพ์ต่อได้อยู่')

    // ─── กู้คืนได้: กดดูซอร์สแล้วแก้ผังที่พังได้จริง ────────────────────
    // ถ้าซ่อนซอร์สไว้แล้วไม่มีทางเปิด ผังที่ AI เขียนพังจะแก้ไม่ได้เลย
    await page.locator('.bn-mermaid').hover()
    await page.getByRole('button', { name: 'ดูซอร์สของผังงาน' }).click()
    await expect(
      page.locator('[data-content-type="codeBlock"][data-language="mermaid"]'),
    ).toBeVisible()
  } finally {
    await fresh.close()
  }
})

test('หน้าที่ไม่มีผังงานต้องไม่โหลด mermaid มาเปล่า ๆ', async ({ browser, request }) => {
  const created = await request.post(`${API}/pages`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Id': workspaceId },
    data: { parentId: null, title: `ไม่มีผังงาน ${stamp}` },
  })
  const plainPageId = ((await created.json()) as { data: { id: string } }).data.id

  await request.post(`${API}/pages/${plainPageId}/content/markdown`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Id': workspaceId },
    data: { markdown: '# หัวข้อธรรมดา\n\nไม่มีผังงานในหน้านี้\n' },
  })

  const fresh = await browser.newContext({ locale: 'th-TH' })
  const page = await fresh.newPage()

  // ⚠️ mermaid + dependency ของมันหนัก 666 kB (164 kB gzip) และแตกเป็น chunk
  //    ของ diagram แต่ละชนิดอีก — หน้าที่ไม่มีผังงานต้องไม่จ่ายค่านี้
  //    ถ้าวันหนึ่งมีคน import มันแบบ static ข้อนี้จะแดงทันที
  //
  //    ⚠️ นับเฉพาะ "ตัวไลบรารี" ไม่ใช่ไฟล์ mermaidPreview.ts ของเราเอง
  //       ตัวนั้นเป็นโค้ดไม่กี่ kB ที่ต้องโหลดอยู่แล้วเพื่อรู้ว่าจะโหลดของหนักเมื่อไหร่
  const libraryRequests: string[] = []
  const isLibrary = (url: string) =>
    /mermaid/i.test(url) && !/mermaidPreview/.test(url)

  page.on('request', (request_) => {
    if (isLibrary(request_.url())) libraryRequests.push(request_.url())
  })

  try {
    await signIn(page)
    await page.goto(`/p/${plainPageId}`)
    await expect(editorBody(page)).toBeVisible()
    await expect(editorBody(page)).toContainText('ไม่มีผังงานในหน้านี้', { timeout: 15_000 })
    await page.waitForTimeout(1500)

    expect(libraryRequests, libraryRequests.join('\n')).toHaveLength(0)

    // ─────────────────────────────────────────────────────────────────
    //  positive control — ถ้าไม่มีข้อนี้ การ assert ว่า "ไม่โหลด" จะผ่านฟรี ๆ
    //  ทันทีที่ใครเปลี่ยนชื่อไฟล์หรือ regex จนไม่แมตช์อะไรเลย
    // ─────────────────────────────────────────────────────────────────
    await page.goto(`/p/${pageId}`)
    await expect(page.locator('.bn-mermaid svg')).toBeVisible({ timeout: 20_000 })
    expect(libraryRequests.length).toBeGreaterThan(0)
  } finally {
    await fresh.close()
  }
})
