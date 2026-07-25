#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  Architecture gates ฝั่ง API (.NET)
//
//  กฎใน PLAN.md ที่ไม่มีเครื่องบังคับ = ของประดับ ไฟล์นี้คือตัวบังคับฝั่ง .NET
//  (ฝั่ง web ใช้ eslint-plugin-boundaries ใน web/eslint.config.js)
//
//      รันเอง:  node scripts/check-architecture.mjs
//      ใน CI:   ดู .github/workflows/ci.yml
//
//  ⚠️ ตัดคอมเมนต์และ string literal ออกก่อน match
//     ไม่ทำแบบนี้ คอมเมนต์ที่อธิบายกฎ ("ห้ามใช้ AllowAnyOrigin()") จะทำให้
//     gate แดงเอง ซึ่งจะจบลงด้วยการที่มีคนปิด gate ทิ้ง
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const C = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  off: '\x1b[0m',
}

// ─── รวมไฟล์ .cs ──────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', '.git', '.vs'])

async function collectCsFiles(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out // โฟลเดอร์ยังไม่มี (phase ก่อนหน้า) — ไม่ถือว่าผิด
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...(await collectCsFiles(full)))
    } else if (entry.name.endsWith('.cs')) {
      out.push(full)
    }
  }
  return out
}

/**
 * ตัดคอมเมนต์และเนื้อใน string literal ออก โดย "คงจำนวนบรรทัดเดิม"
 * เพื่อให้เลขบรรทัดที่รายงานตรงกับไฟล์จริง
 */
function stripCommentsAndStrings(source) {
  let out = ''
  let i = 0
  const n = source.length

  const keepNewlines = (text) => text.replace(/[^\n]/g, ' ')

  while (i < n) {
    const two = source.slice(i, i + 2)

    // block comment
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += keepNewlines(source.slice(i, stop))
      i = stop
      continue
    }

    // line comment (รวม /// xml doc)
    if (two === '//') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? n : end
      out += keepNewlines(source.slice(i, stop))
      i = stop
      continue
    }

    // raw string literal """ … """
    if (source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3)
      const stop = end === -1 ? n : end + 3
      out += keepNewlines(source.slice(i, stop))
      i = stop
      continue
    }

    // string / interpolated string / char
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
      out += keepNewlines(source.slice(i, stop))
      i = stop
      continue
    }

    out += source[i]
    i += 1
  }

  return out
}

// ─── นิยาม gate ───────────────────────────────────────────────────────────
/**
 * แต่ละ gate จะ FAIL เมื่อ "เจอ" match
 * scope  — คืน true ถ้าไฟล์นี้อยู่ในขอบเขตที่ตรวจ (path เป็น posix-style)
 * raw    — true = match บนซอร์สดิบ (ไม่ตัด string) ใช้กับกฎที่ต้องดูในสตริง
 */
const GATES = [
  {
    name: 'Controllers ไม่แตะ AppDbContext / DbSet',
    why: 'query ที่เขียนตรงใน controller คือ query ที่ข้าม tenant filter และ permission check',
    scope: (p) => p.startsWith('api/Controllers/'),
    pattern: /\b(AppDbContext|DbSet\s*<)/,
  },
  {
    name: 'Realtime hubs ไม่แตะ AppDbContext / DbSet',
    why: 'hub คือ controller ที่เปลี่ยน transport — กฎเดียวกัน',
    scope: (p) => p.startsWith('api/Realtime/'),
    pattern: /\b(AppDbContext|DbSet\s*<)/,
  },
  {
    name: 'Services ไม่แตะ AppDbContext โดยตรง',
    why: 'business logic ต้องคุยผ่าน IXxxRepository ไม่ใช่ EF Core',
    scope: (p) => p.startsWith('api/Services/'),
    pattern: /\bAppDbContext\b/,
  },
  {
    name: 'ไม่มี IgnoreQueryFilters() แบบไม่ระบุชื่อ filter',
    why: 'ปิด tenant filter พร้อม soft-delete filter — เป็นวิธีที่ tenant leak หลุด production',
    scope: (p) => p.startsWith('api/') && !p.endsWith('/IdentityQueries.cs'),
    pattern: /IgnoreQueryFilters\s*\(\s*\)/,
  },
  {
    name: 'ไม่มี AutoMapper',
    why: 'map WorkspaceId / PasswordHash ออกไปเงียบ ๆ และพังตอน runtime ไม่ใช่ compile',
    scope: (p) => p.startsWith('api/'),
    pattern: /\bAutoMapper\b/,
  },
  {
    name: 'ไม่มี AllowAnyOrigin()',
    why: 'ใช้ร่วมกับ AllowCredentials() ที่ SignalR ต้องมี → throw ตอน runtime',
    scope: (p) => p.startsWith('api/'),
    pattern: /AllowAnyOrigin\s*\(/,
  },
  {
    name: 'ไม่มี connection string ที่ hardcode ในซอร์ส',
    why: 'secret ต้องมาจาก environment variable เท่านั้น',
    scope: (p) => p.startsWith('api/'),
    raw: true,
    pattern: /(Password|Pwd)\s*=\s*[^;"\s{)]{3,}/i,
  },
]

// ─── รัน ──────────────────────────────────────────────────────────────────
const files = await collectCsFiles(join(ROOT, 'api'))

const scanned = files.map((absolute) => {
  const source = readFileSync(absolute, 'utf8')
  return {
    path: relative(ROOT, absolute).split(sep).join('/'),
    rawLines: source.split('\n'),
    codeLines: stripCommentsAndStrings(source).split('\n'),
  }
})

process.stdout.write(`\n${C.yellow}═══ Architecture gates (api) ═══${C.off}\n`)
process.stdout.write(`${C.dim}ตรวจ ${scanned.length} ไฟล์${C.off}\n\n`)

let failed = false

for (const gate of GATES) {
  const hits = []

  for (const file of scanned) {
    if (!gate.scope(file.path)) continue
    const lines = gate.raw ? file.rawLines : file.codeLines
    lines.forEach((line, index) => {
      if (gate.pattern.test(line)) {
        hits.push(`${file.path}:${index + 1}  ${file.rawLines[index]?.trim() ?? ''}`)
      }
    })
  }

  if (hits.length > 0) {
    failed = true
    process.stdout.write(`${C.red}✗ FAIL${C.off}  ${gate.name}\n`)
    process.stdout.write(`${C.dim}        เหตุผล: ${gate.why}${C.off}\n`)
    for (const hit of hits) process.stdout.write(`${C.dim}        ${hit}${C.off}\n`)
  } else {
    process.stdout.write(`${C.green}✓ PASS${C.off}  ${gate.name}\n`)
  }
}

process.stdout.write('\n')

if (failed) {
  process.stdout.write(`${C.red}✗ architecture gates ไม่ผ่าน${C.off}\n\n`)
  process.exit(1)
}

process.stdout.write(`${C.green}✓ architecture gates ผ่านทั้งหมด${C.off}\n\n`)
