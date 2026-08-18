#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  Architecture gates ฝั่ง server (Node)
//
//  กฎใน PLAN.md ที่ไม่มีเครื่องบังคับ = ของประดับ ไฟล์นี้คือตัวบังคับ
//  (ของเดิมคือ scripts/check-architecture.mjs ที่ตรวจ .cs)
//
//      รันเอง:  npm run check:arch
//      ใน CI:   ดู .github/workflows/ci.yml
//
//  ── กฎที่ "หายไป" เมื่อย้ายมา RLS ─────────────────────────────────────────
//  ของเดิมมีกฎ "ห้าม IgnoreQueryFilters() แบบไม่ระบุชื่อ filter" ซึ่งเป็นกฎที่
//  สำคัญที่สุดในชุด เพราะมันคือวิธีที่ tenant leak หลุด production
//
//  กฎนั้นไม่มีอะไรให้ตรวจแล้ว — Drizzle ไม่มี query filter ให้ปิด และ RLS ปิด
//  จากฝั่งโค้ดไม่ได้เลย แต่ "ทางลัด" ยังมีอยู่ แค่เปลี่ยนหน้าตา:
//  unscopedPool · withOwnTransaction · withoutTenant — สามตัวนี้จึงมี gate
//  ของตัวเองที่จำกัดว่าใครเรียกได้บ้าง (ข้อ 4)
//
//  ⚠️ ตัดคอมเมนต์และ string literal ออกก่อน match — ไม่งั้นคอมเมนต์ที่อธิบายกฎ
//     จะทำให้ gate แดงเอง ซึ่งจะจบลงด้วยการที่มีคนปิด gate ทิ้ง
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'drizzle'])

async function collectFiles(dir, extension) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...(await collectFiles(full, extension)))
    } else if (entry.name.endsWith(extension)) {
      out.push(full)
    }
  }
  return out
}

/**
 * ตัดคอมเมนต์และเนื้อใน string/template literal ออก โดย "คงจำนวนบรรทัดเดิม"
 * เพื่อให้เลขบรรทัดที่รายงานตรงกับไฟล์จริง
 *
 * ⚠️ template literal ถูกตัดเฉพาะ "เนื้อข้อความ" ไม่ตัดทั้งก้อน เพราะ raw SQL
 *    ของเราอยู่ใน sql`…` ซึ่ง gate ข้อ 3 ต้องมองเห็น
 */
function stripCommentsAndStrings(source, { keepTemplates = false } = {}) {
  let out = ''
  let i = 0
  const n = source.length
  const blank = (text) => text.replace(/[^\n]/g, ' ')

  while (i < n) {
    const two = source.slice(i, i + 2)

    if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += blank(source.slice(i, stop))
      i = stop
      continue
    }

    if (two === '//') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? n : end
      out += blank(source.slice(i, stop))
      i = stop
      continue
    }

    if (source[i] === '`') {
      let j = i + 1
      while (j < n && !(source[j] === '`' && source[j - 1] !== '\\')) j += 1
      const stop = Math.min(j + 1, n)
      out += keepTemplates ? source.slice(i, stop) : blank(source.slice(i, stop))
      i = stop
      continue
    }

    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i]
      let j = i + 1
      while (j < n) {
        if (source[j] === '\\') {
          j += 2
          continue
        }
        if (source[j] === quote || source[j] === '\n') break
        j += 1
      }
      const stop = Math.min(j + 1, n)
      out += blank(source.slice(i, stop))
      i = stop
      continue
    }

    out += source[i]
    i += 1
  }

  return out
}

const isController = (p) => p.endsWith('.controller.ts')
const isService = (p) => p.endsWith('.service.ts') && !p.startsWith('src/db/')
const isRepository = (p) => p.endsWith('.repository.ts')

// ─── นิยาม gate — FAIL เมื่อ "เจอ" match ──────────────────────────────────
const GATES = [
  // ─────────────────────────────────────────────────────────────────────
  //  ⚠️ สอง gate นี้ต้อง raw — path ของ import เป็น string literal ซึ่งถูก
  //     stripCommentsAndStrings ลบทิ้งไปก่อน match
  //
  //     เวอร์ชันแรกลืมข้อนี้แล้วทั้งสอง gate เขียวตลอดกาลโดยไม่ตรวจอะไรเลย
  //     (การลองทำผิดกฎแล้วดูว่า gate ยิงไหม เป็นสิ่งที่จับได้ — ไม่ใช่การอ่านโค้ด)
  //
  //     กันคอมเมนต์ฟ้องผิดด้วยการ anchor ที่ต้นบรรทัด: บรรทัด import จริงขึ้นต้น
  //     ด้วย import/export ส่วนคอมเมนต์ขึ้นต้นด้วย // หรือ *
  // ─────────────────────────────────────────────────────────────────────
  {
    name: 'Controller ไม่แตะฐานข้อมูลเอง',
    why: 'query ที่เขียนตรงใน controller คือ query ที่ข้ามการตรวจสิทธิ์ของ service',
    scope: isController,
    raw: true,
    pattern: /^\s*(?:import|export)\s[^\n]*from\s+'[^']*(?:db\/schema|db\/db\.service|\.repository)\.js'/,
  },
  {
    name: 'Service ไม่เขียน query เอง',
    why: 'business logic ต้องคุยผ่าน repository — ไม่งั้นไม่มีที่เดียวให้ review ว่าอ่านอะไรบ้าง',
    scope: isService,
    raw: true,
    // ⚠️ session.savepoint / enterWorkspace / enterIdentity ไม่ผิด — เป็นการคุม
    //    ธุรกรรมและขอบเขต ไม่ใช่การอ่านเขียนข้อมูล กฎนี้จับเฉพาะ session.db
    //    กับการ import ตาราง
    pattern: /(^\s*(?:import|export)\s[^\n]*from\s+'[^']*db\/schema\.js'|\bsession\.db\b)/,
  },
  {
    name: 'raw SQL อยู่ใน repository เท่านั้น',
    why: 'SQL ที่กระจายอยู่ทั่วโค้ดคือ SQL ที่ไม่มีใครไล่อ่านครบตอนแก้ schema',
    scope: (p) => p.startsWith('src/') && !isRepository(p),
    keepTemplates: true,
    pattern: /sql`[\s\S]{0,80}?\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH)\b/i,
  },
  {
    name: 'ทางลัดที่ข้ามขอบเขต tenant ถูกจำกัดที่ผู้เรียก',
    why: 'unscopedPool / withOwnTransaction / withoutTenant ทำงานนอกขอบเขต RLS — ทุกจุดที่เรียกต้องมีเหตุผลที่ review แล้ว',
    scope: (p) =>
      p.startsWith('src/') &&
      ![
        'src/db/db.service.ts',
        // resolve API token เกิดก่อนที่จะรู้ว่า workspace ไหน (ตัว token เป็นคนบอก)
        'src/auth/request-context.interceptor.ts',
        // การเพิกถอนตอนพบ token รั่วต้องอยู่รอดแม้ request จะ rollback
        'src/auth/auth.service.ts',
        // health ตอบได้แม้ยังไม่ล็อกอิน จึงไม่มี tenant ให้ตั้ง
        'src/health/health.repository.ts',
      ].includes(p),
    pattern: /\b(unscopedPool|withOwnTransaction|withoutTenant)\b/,
  },
  {
    name: 'อ่าน process.env ที่ config/env.ts ที่เดียว',
    why: 'env ที่หายไปต้องทำให้ process ไม่ขึ้นเลย ไม่ใช่ทำให้ request ที่ 500 ในอีกสามชั่วโมง',
    scope: (p) => p.startsWith('src/') && p !== 'src/config/env.ts',
    pattern: /process\.env\b/,
  },
  {
    name: 'ไม่มี CORS ที่เปิดให้ทุก origin',
    why: 'ใช้ร่วมกับ credentials: true → เบราว์เซอร์ปฏิเสธ และถ้าไม่ปฏิเสธก็คือเปิดให้ทุกเว็บยิงแทนผู้ใช้',
    scope: (p) => p.startsWith('src/'),
    pattern: /origin\s*:\s*(true|'\*'|"\*")/,
  },
  {
    name: 'ไม่มี connection string ที่ hardcode ในซอร์ส',
    why: 'secret ต้องมาจาก environment variable เท่านั้น',
    scope: (p) => p.startsWith('src/') || p.startsWith('scripts/'),
    raw: true,
    // ต้องเจอ host กับ password ในบรรทัดเดียวกันถึงจะนับว่าเป็น connection string
    // — จับแค่ /password=/ จะฟ้องการ assign ตัวแปรที่ถูกต้อง แล้ว gate จะโดนปิดทิ้ง
    pattern: /(postgres(?:ql)?:\/\/[^\s'"]*:[^\s'"@]{3,}@|(Host|Server)\s*=[^\n"']*?(Password|Pwd)\s*=\s*[^;"'\s{)$]{3,})/i,
  },
]

// ─── gate ฝั่งไฟล์ config ──────────────────────────────────────────────────
const CONFIG_GATES = [
  {
    name: 'package.json ไม่มี drizzle-kit push',
    why: 'push เทียบกับฐานจริงแล้วเสนอ DROP ทุกอย่างที่ไม่มีใน schema.ts — รวม RLS policy ทั้งหมด',
    file: 'package.json',
    pattern: /drizzle-kit\s+push/,
  },
  {
    name: '.env.example ไม่มีค่าลับของจริง',
    why: 'ไฟล์นี้ขึ้น git — ค่าที่หลุดลงไปจะไปโผล่บนทุกเครื่องและเรียกคืนจาก git ไม่ได้',
    file: '.env.example',
    // ค่าที่ยาวและไม่ได้ขึ้นต้นด้วย CHANGE_ME คือค่าจริงที่เผลอ commit
    pattern: /^(JWT_SECRET|DATABASE_URL|DATABASE_ADMIN_URL)\s*=\s*(?!.*CHANGE_ME).{24,}$/m,
  },
]

// ─── รัน ──────────────────────────────────────────────────────────────────
const files = [
  ...(await collectFiles(join(ROOT, 'src'), '.ts')),
  ...(await collectFiles(join(ROOT, 'scripts'), '.ts')),
]

const scanned = files.map((absolute) => {
  const source = readFileSync(absolute, 'utf8')
  return {
    path: relative(ROOT, absolute).split(sep).join('/'),
    rawLines: source.split('\n'),
    codeLines: stripCommentsAndStrings(source).split('\n'),
    codeWithTemplates: stripCommentsAndStrings(source, { keepTemplates: true }).split('\n'),
  }
})

process.stdout.write(`\n${C.yellow}═══ Architecture gates (server) ═══${C.off}\n`)
process.stdout.write(`${C.dim}ตรวจ ${scanned.length} ไฟล์${C.off}\n\n`)

let failed = false

const report = (gate, hits) => {
  if (hits.length === 0) {
    process.stdout.write(`${C.green}✓ PASS${C.off}  ${gate.name}\n`)
    return
  }
  failed = true
  process.stdout.write(`${C.red}✗ FAIL${C.off}  ${gate.name}\n`)
  process.stdout.write(`${C.dim}        เหตุผล: ${gate.why}${C.off}\n`)
  for (const hit of hits) process.stdout.write(`${C.dim}        ${hit}${C.off}\n`)
}

for (const gate of GATES) {
  const hits = []

  for (const file of scanned) {
    if (!gate.scope(file.path)) continue
    const lines = gate.raw
      ? file.rawLines
      : gate.keepTemplates
        ? file.codeWithTemplates
        : file.codeLines

    lines.forEach((line, index) => {
      if (gate.pattern.test(line)) {
        hits.push(`${file.path}:${index + 1}  ${file.rawLines[index]?.trim() ?? ''}`)
      }
    })
  }

  report(gate, hits)
}

for (const gate of CONFIG_GATES) {
  let content
  try {
    content = readFileSync(join(ROOT, gate.file), 'utf8')
  } catch {
    report(gate, [`${gate.file}: อ่านไฟล์ไม่ได้`])
    continue
  }

  const hits = []
  content.split('\n').forEach((line, index) => {
    if (gate.pattern.test(line)) hits.push(`${gate.file}:${index + 1}  ${line.trim()}`)
  })

  report(gate, hits)
}

process.stdout.write('\n')

if (failed) {
  process.stdout.write(`${C.red}✗ architecture gates ไม่ผ่าน${C.off}\n\n`)
  process.exit(1)
}

process.stdout.write(`${C.green}✓ architecture gates ผ่านทั้งหมด${C.off}\n\n`)
