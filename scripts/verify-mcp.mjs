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
const DLL = join(ROOT, 'mcp', 'bin', 'Release', 'net10.0', 'ProjectManagementMcp.dll')

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

// ─── คุยกับ MCP ───────────────────────────────────────────────────────────
console.log(`\n${C.yellow}── handshake ──${C.off}`)

const mcp = new McpProcess({
  PM_API_URL: BASE.replace(/\/api\/v1$/, ''),
  PM_EMAIL: account.email,
  PM_PASSWORD: account.password,
  PM_WORKSPACE: workspaceId,
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

  const expected = ['complete_task', 'create_project', 'create_task', 'get_task',
                    'list_projects', 'list_tasks', 'update_task']
  for (const name of expected) {
    check(`มี tool ${name}`, names.includes(name), `ที่เจอ: ${names.join(', ')}`)
  }

  // schema ที่ผิดทำให้ client เรียก tool ไม่ได้เลย ทั้งที่ tool ปรากฏในรายการ
  const createTask = tools.find((t) => t.name === 'create_task')
  check('create_task มี inputSchema ที่ระบุ parameter ครบ',
    createTask?.inputSchema?.properties?.projectId !== undefined &&
    createTask?.inputSchema?.properties?.title !== undefined,
    JSON.stringify(createTask?.inputSchema))

  check('ทุก tool มีคำอธิบาย (Claude ใช้ตัดสินใจว่าจะเรียกตัวไหน)',
    tools.every((t) => typeof t.description === 'string' && t.description.length > 0),
    tools.filter((t) => !t.description).map((t) => t.name).join(', '))

  console.log(`\n${C.yellow}── tools/call ──${C.off}`)

  async function callTool(name, args = {}) {
    const r = await mcp.send('tools/call', { name, arguments: args })
    const text = r.result?.content?.map((c) => c.text).join('\n') ?? ''
    return { isError: r.result?.isError === true, text, error: r.error }
  }

  const projects = await callTool('list_projects')
  check('list_projects ทำงาน (login + X-Workspace-Id ถูกต้อง)',
    !projects.isError && projects.text.includes('โปรเจกต์ทดสอบ MCP'),
    projects.text || JSON.stringify(projects.error))

  const created = await callTool('create_task', {
    projectId, title: 'งานที่ AI สร้าง', status: 'doing',
  })
  check('create_task สร้างงานได้', !created.isError && created.text.includes('งานที่ AI สร้าง'),
    created.text || JSON.stringify(created.error))

  const taskId = /id=([0-9a-f-]{36})/.exec(created.text)?.[1]
  check('create_task คืน id ที่ใช้เรียก tool ต่อได้', taskId !== undefined, created.text)

  const tasks = await callTool('list_tasks', { projectId })
  check('list_tasks เห็นงานที่เพิ่งสร้าง พร้อมสถานะ doing',
    !tasks.isError && tasks.text.includes('งานที่ AI สร้าง') && tasks.text.includes('doing'),
    tasks.text)

  if (taskId) {
    const done = await callTool('complete_task', { taskId })
    check('complete_task เปลี่ยนสถานะเป็น done', !done.isError && done.text.includes('เสร็จแล้ว'), done.text)

    const afterDone = await callTool('list_tasks', { projectId })
    check('งานที่เสร็จแล้วถูกซ่อนตามค่าเริ่มต้น',
      !afterDone.text.includes('งานที่ AI สร้าง'), afterDone.text)

    const withDone = await callTool('list_tasks', { projectId, includeDone: true })
    check('include_done=true แล้วเห็นอีกครั้ง', withDone.text.includes('งานที่ AI สร้าง'), withDone.text)
  }

  // ─── error ต้องกลับไปเป็นข้อความที่ Claude อ่านรู้เรื่อง ไม่ใช่ crash ──────
  console.log(`\n${C.yellow}── การจัดการ error ──${C.off}`)

  const badStatus = await callTool('update_task', { taskId, status: 'ยังไม่เริ่ม' })
  check('สถานะที่ไม่มีในระบบ → ข้อความบอกค่าที่ถูกต้อง ไม่ใช่ crash',
    badStatus.text.includes('todo') && badStatus.text.includes('done'),
    badStatus.text || JSON.stringify(badStatus.error))

  const missing = await callTool('get_task', { taskId: '00000000-0000-0000-0000-000000000000' })
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
