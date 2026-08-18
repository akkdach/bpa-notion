# ═══════════════════════════════════════════════════════════════════════════
#  publish API (NestJS) สำหรับ IIS
#
#      pwsh scripts/publish-iis.ps1
#      pwsh scripts/publish-iis.ps1 -Output D:\deploy\pm-api
#
#  ⚠️ ต้องมี iisnode หรือ ARR reverse proxy บนเซิร์ฟเวอร์
#
#     ต่างจากรุ่น .NET ตรงที่ IIS ไม่ได้ "โฮสต์" process ให้เอง — Node ต้องรัน
#     เป็น process ของตัวเองแล้ว IIS ส่งต่อคำขอไปให้ วิธีที่แนะนำคือ
#     ARR (Application Request Routing) proxy ไปที่ http://localhost:PORT
#     ซึ่งไม่ต้องลง iisnode และอัปเดต Node ได้โดยไม่แตะ IIS เลย
#
#     ส่วน process ให้รันด้วย NSSM / Windows Service / pm2 — ดู README
#
#  ⚠️ ไม่มีขั้น "แพ็ก runtime ไปด้วย" แบบ self-contained ของ .NET
#     Node ต้องลงบนเครื่องปลายทาง (>= 22) แลกกับที่ artifact เล็กลงมาก
#     (~40 MB เทียบกับ ~120 MB) และ security patch ของ Node อัปเดตแยกได้
#
#  ⚠️ ไฟล์นี้ต้องเซฟเป็น UTF-8 พร้อม BOM — Windows PowerShell 5.1 อ่าน .ps1
#     ที่ไม่มี BOM เป็น ANSI ทำให้คอมเมนต์ไทยเพี้ยนจน parser พังทั้งไฟล์
# ═══════════════════════════════════════════════════════════════════════════
param(
    [string]$Output = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root 'server'
if (-not (Test-Path (Join-Path $server 'package.json'))) { Write-Error "ไม่พบ $server\package.json" }

if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path $root 'server\publish'
}

Write-Host ''
Write-Host "publish ไปที่: $Output" -ForegroundColor Cyan

# ═══════════════════════════════════════════════════════════════════════════
#  ลบของเก่าก่อน
#
#  ⚠️ คัดลอกทับโฟลเดอร์เดิมไม่ลบไฟล์ที่หายไปจาก build ใหม่ — โมดูลที่ถูกถอด
#     ออกจาก package.json จะยังค้างอยู่ใน node_modules ปลายทาง แล้วโค้ดที่
#     import มันจะยังทำงานได้บนเซิร์ฟเวอร์ทั้งที่พังบนเครื่อง dev
# ═══════════════════════════════════════════════════════════════════════════
if (Test-Path $Output) {
    Write-Host 'ลบ publish เดิม' -ForegroundColor DarkGray
    Remove-Item -Recurse -Force $Output
}
foreach ($stale in @('dist')) {
    $path = Join-Path $server $stale
    if (Test-Path $path) { Remove-Item -Recurse -Force $path }
}

Push-Location $server
try {
    Write-Host 'ติดตั้ง dependency (รวม dev เพื่อ build)' -ForegroundColor DarkGray
    npm ci
    if ($LASTEXITCODE -ne 0) { Write-Error 'npm ci ล้มเหลว' }

    Write-Host 'build' -ForegroundColor DarkGray
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Error 'build ล้มเหลว' }

    # ─────────────────────────────────────────────────────────────────────
    #  ⚠️ ต้อง prune หลัง build ไม่ใช่ก่อน
    #
    #     nest cli กับ typescript อยู่ใน devDependencies — ตัดก่อนแล้ว build
    #     ไม่ได้ ส่วนการส่ง devDependencies ขึ้นเซิร์ฟเวอร์คือการเพิ่มพื้นที่
    #     โจมตีโดยไม่ได้อะไรกลับมา
    # ─────────────────────────────────────────────────────────────────────
    Write-Host 'ตัด devDependencies' -ForegroundColor DarkGray
    npm prune --omit=dev
    if ($LASTEXITCODE -ne 0) { Write-Error 'npm prune ล้มเหลว' }
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $Output | Out-Null

# ═══════════════════════════════════════════════════════════════════════════
#  สิ่งที่ต้องไปด้วย
#
#  ⚠️ drizzle/ กับ sql/ ต้องไปด้วย ไม่ใช่แค่ dist/ — `npm run db:setup` บน
#     เซิร์ฟเวอร์อ่านสองโฟลเดอร์นี้ ถ้าลืม schema จะลงไม่ได้และ error ที่ได้
#     จะบอกแค่ว่า "ไม่พบ migration folder" ซึ่งชี้ไปที่ปัญหาการ deploy ไม่ใช่โค้ด
# ═══════════════════════════════════════════════════════════════════════════
foreach ($item in @('dist', 'node_modules', 'drizzle', 'sql', 'scripts', 'package.json')) {
    $source = Join-Path $server $item
    if (-not (Test-Path $source)) { Write-Error "ไม่พบ $source" }

    Write-Host "คัดลอก $item" -ForegroundColor DarkGray
    Copy-Item -Recurse -Force $source (Join-Path $Output $item)
}

# ═══════════════════════════════════════════════════════════════════════════
#  ตรวจว่าได้ของที่ใช้ได้จริง ไม่ใช่แค่ "คำสั่งไม่ error"
#
#  ⚠️ argon2 เป็น native addon — ถ้า npm ci รันบนเครื่องที่สถาปัตยกรรมต่างจาก
#     เซิร์ฟเวอร์ ไฟล์ .node ที่ได้จะโหลดไม่ขึ้น และอาการจะโผล่ตอน "สมัคร
#     สมาชิกครั้งแรก" ไม่ใช่ตอน deploy
# ═══════════════════════════════════════════════════════════════════════════
$entry = Join-Path $Output 'dist\main.js'
if (-not (Test-Path $entry)) { Write-Error "publish แล้วแต่ไม่มี $entry" }

$argon = Get-ChildItem -Path (Join-Path $Output 'node_modules\argon2') -Filter '*.node' -Recurse -ErrorAction SilentlyContinue
if (-not $argon) {
    Write-Error @'
ไม่พบไฟล์ .node ของ argon2 ใน publish

argon2 เป็น native addon ที่ต้อง build ตรงกับ OS/สถาปัตยกรรมของเครื่องปลายทาง
ถ้า publish จาก Windows แล้วเอาไปวางบน Windows เหมือนกันควรจะมี — ถ้าไม่มี
แปลว่า npm ci ข้ามขั้น build ไป (มักเป็นเพราะไม่มี build tools)
'@
}

$size = [math]::Round((Get-ChildItem -Recurse $Output | Measure-Object -Property Length -Sum).Sum / 1MB, 1)

Write-Host ''
Write-Host "✓ publish สำเร็จ — $size MB" -ForegroundColor Green
Write-Host ''
Write-Host 'ขั้นต่อไปบนเซิร์ฟเวอร์:' -ForegroundColor Yellow
Write-Host '  1. ตั้ง environment variable: DATABASE_URL, JWT_SECRET, JWT_ISSUER, WEB_ORIGIN, PORT'
Write-Host '  2. ลง schema ครั้งแรก:  npm run db:setup   (ต้องมี DATABASE_ADMIN_URL ชั่วคราว)'
Write-Host '  3. รันเป็น service:      node dist\main.js  (ผ่าน NSSM / pm2)'
Write-Host '  4. ตั้ง ARR ใน IIS ให้ proxy /api ไปที่ http://localhost:PORT'
Write-Host ''
Write-Host '⚠️ DATABASE_URL ต้องเป็น pm_app ไม่ใช่ postgres — RLS ไม่มีผลกับ superuser' -ForegroundColor Yellow
Write-Host ''
