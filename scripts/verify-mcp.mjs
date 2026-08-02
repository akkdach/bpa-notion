#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  พิสูจน์ว่า MCP server คุยกับ Claude Code ได้จริง
//
//      node scripts/verify-mcp.mjs [baseUrl]
//
//  ทำไมต้องมี: "build ผ่าน" ไม่ได้แปลว่า MCP ใช้ได้ MCP server พังได้หลายแบบ
//  ที่ compiler มองไม่เห็นเลย — log หลุดลง stdout จนปน JSON-RPC, tool ไม่ถูก
//  ค้นเจอเพราะลืม attribute, schema ของ parameter ผิดจน client เรียกไม่ได้,
//  หรือ handshake ค้างเพราะ config หาย  ทั้งหมดนี้เห็นได้ทางเดียวคือพูด
//  JSON-RPC กับมันจริง ๆ
//
//  สคริปต์นี้สมัครบัญชีใช้แล้วทิ้งของตัวเอง แล้วส่ง credential ให้ MCP ทาง
//  env var — จึงไม่แตะ User Secrets ของคนใช้และไม่ต้องรู้รหัสผ่านใคร
//
//  ต้องมี API รันอยู่ก่อน:  dotnet run --project api
// ═══════════════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5081/api/v1'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️ PM_MCP_DLL — ทางออกตอนที่ Claude Code กำลังรัน MCP server อยู่
//
//  Claude Code ถือ ProjectManagementMcp.dll เปิดไว้ตลอด session ทำให้ build
//  ทับไม่ได้ ("file is locked by .NET Host") แปลว่าแก้โค้ดใน mcp/ แล้วจะยืนยัน
//  ไม่ได้เลยจนกว่าจะปิด Claude Code — ซึ่งไม่ใช่ workflow ที่ใช้ได้จริง
//
//  ทางออก: build ด้วยชื่อ assembly อื่นแล้วชี้มาที่ตัวนั้น
//
//      dotnet build mcp -c Release -p:AssemblyName=ProjectManagementMcpVerify
//      PM_MCP_DLL=mcp/bin/Release/net10.0/ProjectManagementMcpVerify.dll \
//        node scripts/verify-mcp.mjs
//
//  CI ไม่ต้องใช้ — ที่นั่นไม่มีใครถือไฟล์อยู่
// ═══════════════════════════════════════════════════════════════════════════
const DLL = process.env.PM_MCP_DLL
  ? (process.env.PM_MCP_DLL.match(/^([A-Za-z]:|\/)/) ? process.env.PM_MCP_DLL : join(ROOT, process.env.PM_MCP_DLL))
  : join(ROOT, 'mcp', 'bin', 'Release', 'net10.0', 'ProjectManagementMcp.dll')

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

let passed = 0
let failed = 0

function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`  ${C.green}✓${C.off} ${label}`) }
  else { failed++; console.log(`  ${C.red}✗${C.off} ${label}${detail ? `\n      ${C.dim}${detail}${C.off}` : ''}`) }
}

// ─── บัญชีใช้แล้วทิ้ง ──────────────────────────────────────────────────────
const stamp = String(Date.now() % 1_000_000)
const account = {
  email: `mcp.${stamp}@ทดสอบ.local`,
  password: 'รหัสผ่านยาวพอสมควรนะครับ',
  name: 'ผู้ทดสอบ MCP',
}

async function api(path, { method = 'POST', body, token, workspaceId } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId

  const r = await fetch(`${BASE}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ตัวคุย JSON-RPC กับ MCP server
//
//  ⚠️ MCP stdio ใช้ JSON คั่นด้วย newline ไม่ใช่ Content-Length framing
//     แบบ LSP — เข้าใจผิดตรงนี้แล้วจะค้างรอ response ที่ไม่มีวันมา
// ═══════════════════════════════════════════════════════════════════════════
class McpProcess {
  #child
  #pending = new Map()
  #nextId = 1
  stderr = ''

  constructor(env) {
    this.#child = spawn('dotnet', [DLL], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.#child.stderr.on('data', (d) => { this.stderr += d.toString() })

    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      if (!line.trim()) return
      let message
      try {
        message = JSON.parse(line)
      } catch {
        // บรรทัดที่ parse ไม่ได้บน stdout = มีอะไรพิมพ์ปนช่องโปรโตคอล
        // เก็บไว้รายงาน ไม่ทิ้งเงียบ ๆ เพราะนี่คือบั๊กคลาสสิกของ MCP stdio
        this.junkOnStdout ??= []
        this.junkOnStdout.push(line)
        return
      }
      const resolve = this.#pending.get(message.id)
      if (resolve) { this.#pending.delete(message.id); resolve(message) }
    })
  }

  send(method, params) {
    const id = this.#nextId++
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, resolve)
      setTimeout(() => {
        if (this.#pending.delete(id)) {
          reject(new Error(`timeout รอ ${method}\nstderr:\n${this.stderr.slice(-800)}`))
        }
      }, 30_000)
    })
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return promise
  }

  notify(method, params) {
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  kill() { this.#child.kill() }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`${C.yellow}═══ ตรวจ MCP server ═══${C.off}\n`)

console.log(`${C.yellow}── เตรียมบัญชีและข้อมูล ──${C.off}`)

const registered = await api('/auth/register', { body: account })
check('สมัครบัญชีใช้แล้วทิ้ง', registered.status === 200, JSON.stringify(registered.body))

const token = registered.body?.data?.accessToken
const ws = await api('/workspaces', { body: { name: `MCP ${stamp}` }, token })
check('สร้าง workspace', ws.status === 201, JSON.stringify(ws.body))

const workspaceId = ws.body?.data?.id
const project = await api('/pages', { body: { parentId: null, title: 'โปรเจกต์ทดสอบ MCP' }, token, workspaceId })
check('สร้างโปรเจกต์ (หน้าระดับบนสุด)', project.status === 201, JSON.stringify(project.body))

const projectId = project.body?.data?.id

// ─────────────────────────────────────────────────────────────────────────
//  กุญแจที่ MCP จะใช้
//
//  ⚠️ ไม่ใช่บัญชีข้างบน — token ผูกกับ "บัญชี agent" ที่เซิร์ฟเวอร์สร้างให้
//     ตอนออกใบแรก MCP จึงทำงานในนามคนละคนกับที่สร้างโปรเจกต์ไว้
//
//     นั่นคือของจริงที่ลูกค้าใช้ และเป็นเงื่อนไขที่ทำให้ "เจ้าของแยกงานที่ AI
//     ทำออกจากงานที่ตัวเองทำได้" เป็นจริง — ถ้าเทสต์ใช้บัญชีเดียวกันทั้งสองฝั่ง
//     มันจะผ่านโดยไม่พิสูจน์เรื่องนั้นเลย
// ─────────────────────────────────────────────────────────────────────────
const issued = await api('/workspaces/current/tokens', {
  body: { name: 'verify-mcp' }, token, workspaceId,
})
check('ออก API token ให้ MCP', issued.status === 200, JSON.stringify(issued.body))
const apiToken = issued.body?.data?.token

// ─── คุยกับ MCP ───────────────────────────────────────────────────────────
console.log(`\n${C.yellow}── handshake ──${C.off}`)

// ⚠️ ไม่มี PM_WORKSPACE แล้ว — ขอบเขตมากับตัว token ถ้ายังส่งอยู่จะเข้าใจผิดว่า
//    สลับ workspace ได้ด้วยการแก้ค่านี้ (สลับไม่ได้ ต้องออกใบใหม่ใน workspace นั้น)
const mcp = new McpProcess({
  PM_API_URL: BASE.replace(/\/api\/v1$/, ''),
  PM_TOKEN: apiToken,
})

try {
  const init = await mcp.send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'verify-mcp', version: '1.0.0' },
  })
  check('initialize สำเร็จ', init.result !== undefined, JSON.stringify(init.error))
  check('เซิร์ฟเวอร์บอกชื่อและ capability ของ tools',
    init.result?.capabilities?.tools !== undefined,
    JSON.stringify(init.result?.capabilities))

  mcp.notify('notifications/initialized')

  console.log(`\n${C.yellow}── tools/list ──${C.off}`)

  const list = await mcp.send('tools/list', {})
  const tools = list.result?.tools ?? []
  const names = tools.map((t) => t.name).sort()

  check(`ค้นเจอ tool ${tools.length} ตัว`, tools.length > 0, JSON.stringify(list.error))

  // ═════════════════════════════════════════════════════════════════════
  //  tool ที่ต้องมี — และ "ต้องไม่มี"
  //
  //  จำนวน tool ถูกคุมไว้โดยเจตนา: schema ของทุกตัวอยู่ใน system prompt ของ
  //  ทุก session ในโฟลเดอร์นี้ตลอดไป และ tool คล้ายกันหลายตัวทำให้โมเดล
  //  เลือกผิดบ่อยขึ้น เทสจึงล็อกทั้งสองด้าน ไม่ใช่แค่ด้าน "มีครบ"
  // ═════════════════════════════════════════════════════════════════════
  const expected = ['add_note', 'append_content', 'create_page', 'delete_page', 'find_pages',
                    'get_page', 'restore_page', 'update_page']
  for (const name of expected) {
    check(`มี tool ${name}`, names.includes(name), `ที่เจอ: ${names.join(', ')}`)
  }

  check('ไม่มี tool เกินจากที่ประกาศไว้ (คุมขนาด system prompt)',
    names.length === expected.length,
    `ที่เจอ: ${names.join(', ')}`)

  // ⚠️ ลบถาวรต้องไม่อยู่ในมือ AI — เป็นการตัดสินใจเรื่องความปลอดภัย ไม่ใช่ ergonomics
  check('ไม่มี tool ลบถาวร (purge) ให้ AI',
    !names.some((n) => n.includes('purge')), names.join(', '))

  // schema ที่ผิดทำให้ client เรียก tool ไม่ได้เลย ทั้งที่ tool ปรากฏในรายการ
  const createPage = tools.find((t) => t.name === 'create_page')
  check('create_page มี inputSchema ที่ระบุ parameter ครบ',
    createPage?.inputSchema?.properties?.title !== undefined &&
    createPage?.inputSchema?.properties?.parentId !== undefined &&
    createPage?.inputSchema?.properties?.status !== undefined,
    JSON.stringify(createPage?.inputSchema))

  const findPages = tools.find((t) => t.name === 'find_pages')
  check('find_pages รับทั้ง query, parentId, status และ inTrash',
    ['query', 'parentId', 'status', 'inTrash']
      .every((p) => findPages?.inputSchema?.properties?.[p] !== undefined),
    JSON.stringify(findPages?.inputSchema?.properties))

  check('ทุก tool มีคำอธิบาย (Claude ใช้ตัดสินใจว่าจะเรียกตัวไหน)',
    tools.every((t) => typeof t.description === 'string' && t.description.length > 0),
    tools.filter((t) => !t.description).map((t) => t.name).join(', '))

  console.log(`\n${C.yellow}── tools/call ──${C.off}`)

  async function callTool(name, args = {}) {
    const r = await mcp.send('tools/call', { name, arguments: args })
    const text = r.result?.content?.map((c) => c.text).join('\n') ?? ''
    return { isError: r.result?.isError === true, text, error: r.error }
  }

  const projects = await callTool('find_pages')
  check('find_pages ไม่ใส่พารามิเตอร์ = ภาพรวมโปรเจกต์ (login + X-Workspace-Id ถูกต้อง)',
    !projects.isError && projects.text.includes('โปรเจกต์ทดสอบ MCP'),
    projects.text || JSON.stringify(projects.error))

  const created = await callTool('create_page', {
    parentId: projectId, title: 'งานที่ AI สร้าง', status: 'doing',
  })
  check('create_page สร้างงานใต้โปรเจกต์ได้',
    !created.isError && created.text.includes('งานที่ AI สร้าง'),
    created.text || JSON.stringify(created.error))

  const taskId = /id=([0-9a-f-]{36})/.exec(created.text)?.[1]
  check('create_page คืน id ที่ใช้เรียก tool ต่อได้', taskId !== undefined, created.text)

  const tasks = await callTool('find_pages', { parentId: projectId })
  check('find_pages ด้วย parent_id เห็นงานที่เพิ่งสร้าง พร้อมสถานะ doing',
    !tasks.isError && tasks.text.includes('งานที่ AI สร้าง') && tasks.text.includes('doing'),
    tasks.text)

  const topLevel = await callTool('create_page', { title: 'โปรเจกต์ที่ AI สร้างเอง' })
  check('create_page ไม่ใส่ parent_id = สร้างโปรเจกต์ระดับบนสุด',
    !topLevel.isError && topLevel.text.includes('สร้างโปรเจกต์แล้ว'),
    topLevel.text || JSON.stringify(topLevel.error))

  // ─── ค้นหา: หน้าที่ AI สร้างต้องหาเจอทันที ────────────────────────────────
  // ก่อนที่ AddAsync จะ seed แถวใน page_searches เคสนี้ล้มเสมอ เพราะแถวนั้น
  // เกิดตอนเบราว์เซอร์ POST /projection เท่านั้น
  const searched = await callTool('find_pages', { query: 'ที่ AI สร้าง' })
  check('find_pages ด้วย query ค้นเจอหน้าที่ AI สร้างเอง (ไม่ต้องเปิดเบราว์เซอร์)',
    !searched.isError && searched.text.includes('งานที่ AI สร้าง'),
    searched.text || JSON.stringify(searched.error))

  // ─── อ่านเนื้อหา ────────────────────────────────────────────────────────
  const read = await callTool('get_page', { pageId: taskId })
  check('get_page อ่านรายละเอียดได้', !read.isError && read.text.includes('งานที่ AI สร้าง'),
    read.text || JSON.stringify(read.error))
  check('get_page แยก "ยังไม่มีข้อมูล" ออกจาก "หน้าว่าง" ให้ชัด',
    read.text.includes('ว่างจริง') || read.text.includes('ยังไม่มีข้อมูล'),
    read.text)

  if (taskId) {
    const done = await callTool('update_page', { pageId: taskId, status: 'done' })
    check('update_page เปลี่ยนสถานะเป็น done', !done.isError && done.text.includes('done'), done.text)

    const afterDone = await callTool('find_pages', { parentId: projectId })
    check('งานที่เสร็จแล้วถูกซ่อนตามค่าเริ่มต้น',
      !afterDone.text.includes('งานที่ AI สร้าง'), afterDone.text)

    const withDone = await callTool('find_pages', { parentId: projectId, includeDone: true })
    check('include_done=true แล้วเห็นอีกครั้ง', withDone.text.includes('งานที่ AI สร้าง'), withDone.text)

    const cleared = await callTool('update_page', { pageId: taskId, clearStatus: true })
    check('clear_status=true ทำให้กลับเป็นหน้าปกติที่ไม่ใช่งาน',
      !cleared.isError && cleared.text.includes('ไม่ใช่งาน'), cleared.text)
  }

  // ─── บันทึกความคืบหน้า ──────────────────────────────────────────────────
  // ช่องเดียวที่ AI เขียนข้อความลงระบบได้ โดยไม่ต้องแตะ Yjs
  console.log(`\n${C.yellow}── บันทึกความคืบหน้า ──${C.off}`)

  const noteBody = 'ตรวจสอบยอดขายไตรมาสสามแล้ว พบว่าข้อมูลเดือนกันยายนยังไม่ครบ'
  const noted = await callTool('add_note', { pageId: taskId, body: noteBody })
  check('add_note เขียนบันทึกได้', !noted.isError && noted.text.includes('เขียนบันทึกแล้ว'),
    noted.text || JSON.stringify(noted.error))

  const withNotes = await callTool('get_page', { pageId: taskId })
  check('get_page แสดงบันทึกที่เพิ่งเขียน',
    withNotes.text.includes(noteBody), withNotes.text)
  check('บันทึกบอกว่าใครเขียน (คนหรือ AI)',
    withNotes.text.includes('👤') || withNotes.text.includes('🤖'), withNotes.text)

  const emptyNote = await callTool('add_note', { pageId: taskId, body: '   ' })
  check('บันทึกว่างเปล่า → ข้อความบอกเหตุผล ไม่ใช่ crash',
    emptyNote.text.includes('ว่างเปล่า'), emptyNote.text)

  // ─── เขียนเนื้อหาในหน้าจริง ─────────────────────────────────────────────
  const appended = await callTool('append_content', {
    pageId: taskId,
    markdown: [
      '## สรุปที่ AI เขียน',
      '',
      '- ตรวจแล้วเรียบร้อย',
      '',
      '```mermaid',
      'graph TD',
      '  A[เริ่ม] --> B[จบ]',
      '```',
      '',
    ].join('\n'),
  })
  check('append_content เขียนเนื้อหาลงหน้าได้',
    !appended.isError && appended.text.includes('ต่อท้ายเนื้อหาหน้าแล้ว'),
    appended.text || JSON.stringify(appended.error))

  const readAfter = await callTool('get_page', { pageId: taskId })
  check('get_page อ่านเนื้อหาที่เพิ่งเขียนกลับมาได้',
    readAfter.text.includes('สรุปที่ AI เขียน'), readAfter.text)

  // AI ต้องอ่านซอร์สผังงานที่ตัวเองเขียนกลับมาได้ ไม่งั้นแก้ผังของตัวเองไม่ได้
  check('ซอร์สของผังงานอ่านกลับมาได้ด้วย',
    readAfter.text.includes('graph TD'), readAfter.text)

  // ⚠️ ของที่ schema รับไม่ได้ต้อง "สำเร็จแล้วเตือน" ไม่ใช่ล้มเหลว
  //    โมเดลมองผลลัพธ์ไม่เห็น การเงียบแปลว่ามันเชื่อว่าเขียนตารางไปแล้ว
  const withTable = await callTool('append_content', {
    pageId: taskId,
    markdown: '| สาขา | ยอด |\n|---|---|\n| รังสิต | 120 |\n',
  })
  check('ตารางเขียนได้แต่บอกกลับว่าถูกลดรูป',
    !withTable.isError && withTable.text.includes('⚠️'),
    withTable.text || JSON.stringify(withTable.error))

  const emptyContent = await callTool('append_content', { pageId: taskId, markdown: '   ' })
  check('เนื้อหาว่างเปล่า → ข้อความบอกเหตุผล ไม่ใช่ crash',
    emptyContent.text.includes('ไม่มีเนื้อหา'), emptyContent.text)

  // ─── ย้าย / ลบ / กู้คืน ──────────────────────────────────────────────────
  console.log(`\n${C.yellow}── จัดการโครงสร้าง ──${C.off}`)

  const moved = await callTool('update_page', { pageId: taskId, moveToTopLevel: true })
  check('update_page ย้ายหน้าขึ้นระดับบนสุดได้', !moved.isError && moved.text.includes('ย้ายแล้ว'),
    moved.text || JSON.stringify(moved.error))

  const deleted = await callTool('delete_page', { pageId: taskId })
  check('delete_page ย้ายไปถังขยะได้', !deleted.isError && deleted.text.includes('ถังขยะ'),
    deleted.text || JSON.stringify(deleted.error))

  const trash = await callTool('find_pages', { inTrash: true })
  check('find_pages in_trash=true เห็นหน้าที่ถูกลบ',
    !trash.isError && trash.text.includes('งานที่ AI สร้าง'),
    trash.text || JSON.stringify(trash.error))

  const restored = await callTool('restore_page', { pageId: taskId })
  check('restore_page กู้คืนได้', !restored.isError && restored.text.includes('กู้คืนแล้ว'),
    restored.text || JSON.stringify(restored.error))

  // ─── error ต้องกลับไปเป็นข้อความที่ Claude อ่านรู้เรื่อง ไม่ใช่ crash ──────
  console.log(`\n${C.yellow}── การจัดการ error ──${C.off}`)

  const badStatus = await callTool('update_page', { pageId: taskId, status: 'ยังไม่เริ่ม' })
  check('สถานะที่ไม่มีในระบบ → ข้อความบอกค่าที่ถูกต้อง ไม่ใช่ crash',
    badStatus.text.includes('todo') && badStatus.text.includes('done'),
    badStatus.text || JSON.stringify(badStatus.error))

  const conflicting = await callTool('update_page', {
    pageId: taskId, status: 'todo', clearStatus: true,
  })
  check('สั่งขัดกันเอง (status + clear_status) → บอกให้เลือกอย่างเดียว',
    conflicting.text.includes('เลือกอย่างเดียว'), conflicting.text)

  const nothing = await callTool('update_page', { pageId: taskId })
  check('ไม่ระบุอะไรให้เปลี่ยน → บอกว่าต้องระบุอะไรบ้าง',
    nothing.text.includes('ไม่มีอะไรให้เปลี่ยน'), nothing.text)

  const missing = await callTool('get_page', { pageId: '00000000-0000-0000-0000-000000000000' })
  check('หน้าที่ไม่มีอยู่ → error ที่อ่านรู้เรื่อง',
    (missing.text + JSON.stringify(missing.error)).length > 0, '(ไม่ได้อะไรกลับมาเลย)')

  console.log(`\n${C.yellow}── ความสะอาดของช่องโปรโตคอล ──${C.off}`)

  check('ไม่มีอะไรที่ไม่ใช่ JSON-RPC หลุดลง stdout',
    mcp.junkOnStdout === undefined,
    (mcp.junkOnStdout ?? []).slice(0, 3).join(' | '))
} finally {
  mcp.kill()
}

console.log(`\nผ่าน ${C.green}${passed}${C.off} / ไม่ผ่าน ${failed > 0 ? C.red : C.dim}${failed}${C.off}\n`)
process.exit(failed > 0 ? 1 : 0)
