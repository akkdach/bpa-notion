# ═══════════════════════════════════════════════════════════════════════════
#  publish API สำหรับ IIS — แบบ self-contained
#
#      pwsh scripts/publish-iis.ps1
#      pwsh scripts/publish-iis.ps1 -Output D:\deploy\pm-api
#
#  ⚠️ self-contained = แพ็ก .NET runtime ไปกับแอป **ไม่ต้องลง runtime บนเซิร์ฟเวอร์**
#
#     ทำแบบนี้เพราะเซิร์ฟเวอร์ปลายทางมีระบบอื่นรันอยู่บน .NET รุ่นเก่ากว่า
#     framework-dependent จะได้ 500.31 (Failed to load ASP.NET Core runtime)
#     และการไปลง Hosting Bundle รุ่นใหม่ต้อง iisreset ซึ่งกระทบระบบอื่นด้วย
#
#     สิ่งเดียวที่ยังต้องมีบนเซิร์ฟเวอร์คือ AspNetCoreModuleV2 (มากับ Hosting
#     Bundle เวอร์ชันไหนก็ได้) — ถ้ามี ASP.NET Core site อื่นรันอยู่แล้วก็มีแล้ว
#
#  แลกกับ: ขนาด ~120 MB และ security patch ของ .NET ต้อง publish ใหม่เอง
#  ไม่ได้อัปเดตตามเครื่อง
#
#  ⚠️ ไฟล์นี้ต้องเซฟเป็น UTF-8 พร้อม BOM — Windows PowerShell 5.1 อ่าน .ps1
#     ที่ไม่มี BOM เป็น ANSI ทำให้คอมเมนต์ไทยเพี้ยนจน parser พังทั้งไฟล์
# ═══════════════════════════════════════════════════════════════════════════
param(
    [string]$Output = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'api\ProjectManagementAPI.csproj'
if (-not (Test-Path $project)) { Write-Error "ไม่พบ $project" }

if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path $root 'api\publish'
}

Write-Host ''
Write-Host "publish ไปที่: $Output" -ForegroundColor Cyan

# ─────────────────────────────────────────────────────────────────────────
#  ลบของเก่าก่อน
#
#  ⚠️ publish ทับโฟลเดอร์เดิมไม่ได้ลบไฟล์ที่หายไปจาก build ใหม่ — ไฟล์ค้างจาก
#     รุ่นก่อนจะอยู่ต่อ แล้วทำให้ debug ยาก (เช่น .dll ของ dependency ที่ถอดออกแล้ว)
# ─────────────────────────────────────────────────────────────────────────
if (Test-Path $Output) {
    Remove-Item $Output -Recurse -Force
}

dotnet publish $project `
    --configuration Release `
    --runtime win-x64 `
    --self-contained true `
    --output $Output

if ($LASTEXITCODE -ne 0) { Write-Error 'publish ไม่ผ่าน' }

# ═══════════════════════════════════════════════════════════════════════════
#  ตรวจของที่ "ขาดแล้วพังเงียบ ๆ"
#
#  ทั้งสามอย่างนี้ขาดแล้ว publish ยังสำเร็จ แต่ไปพังตอน runtime บนเซิร์ฟเวอร์
#  ซึ่งเป็นที่ที่แย่ที่สุดในการรู้
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ''
$failed = $false

function Check([string]$label, [bool]$ok, [string]$detail = '') {
    if ($ok) { Write-Host "  [ok] $label" -ForegroundColor Green }
    else {
        Write-Host "  [!!] $label" -ForegroundColor Red
        if ($detail) { Write-Host "       $detail" -ForegroundColor DarkGray }
        $script:failed = $true
    }
}

Check 'มี ProjectManagementAPI.exe (ไม่ต้องพึ่ง dotnet บนเครื่อง)' `
    (Test-Path (Join-Path $Output 'ProjectManagementAPI.exe'))

Check 'มี .NET runtime แพ็กมาด้วย (coreclr.dll)' `
    (Test-Path (Join-Path $Output 'coreclr.dll')) `
    'ถ้าไม่มี แปลว่า publish ออกมาแบบ framework-dependent จะได้ 500.31 บนเครื่องที่ไม่มี .NET 10'

# ⚠️ native ของ Yjs — ขาดแล้ว append_content (รวมผังงาน mermaid) พังตอน runtime
#    ส่วนอย่างอื่นทำงานปกติหมด จึงหาสาเหตุยากมาก
Check 'มี yrs.dll (native ของ Yjs — ใช้เขียนเนื้อหาหน้า)' `
    ((Test-Path (Join-Path $Output 'yrs.dll')) -or
     (Test-Path (Join-Path $Output 'runtimes\win-x64\native\yrs.dll'))) `
    'ขาดตัวนี้ append_content จะพัง แต่ API ส่วนอื่นยังทำงาน — เจอตอน AI เขียนเนื้อหาแล้ว error'

# ⚠️ ถ้า IsTransformWebConfigDisabled หลุด SDK จะ generate ทับแล้ว
#    environmentVariables ที่ตั้งไว้หายหมด
$webConfig = Join-Path $Output 'web.config'
$hasEnv = (Test-Path $webConfig) -and
          ((Get-Content $webConfig -Raw) -match 'Cors__AllowedOrigins__0')

Check 'web.config มี environmentVariables ของเราครบ' $hasEnv `
    'ถ้าหาย แปลว่า SDK generate ทับ — ตรวจ IsTransformWebConfigDisabled ใน csproj'

if ($failed) { Write-Error 'publish ออกมาไม่ครบ — อย่าเพิ่งเอาขึ้นเซิร์ฟเวอร์' }

$size = [math]::Round((Get-ChildItem $Output -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host ''
Write-Host "เรียบร้อย — $size MB" -ForegroundColor Green
Write-Host ''
Write-Host 'ขั้นต่อไปบนเซิร์ฟเวอร์:' -ForegroundColor Cyan
Write-Host "  1. ก๊อปโฟลเดอร์นี้ไปที่ physical path ของ site"
Write-Host '  2. App Pool ต้องเป็น 64-bit  (Enable 32-Bit Applications = False)'
Write-Host '     ไม่งั้น yrs.dll โหลดไม่ขึ้น แล้วผังงาน mermaid พังโดยที่อย่างอื่นปกติ'
Write-Host '  3. ตั้งความลับที่ App Pool (ไม่ใช่ใน web.config ที่ขึ้น git):'
Write-Host '       ConnectionStrings__DefaultConnection'
Write-Host '       Jwt__Key'
Write-Host '     วิธีเต็มอยู่ใน docs/deploy-iis.md'
Write-Host '  4. สร้างโฟลเดอร์ logs\ แล้วให้ app pool identity เขียนได้'
Write-Host '     (stdoutLogEnabled=true อยู่ — ไม่มีโฟลเดอร์นี้จะไม่มี log ให้ดูตอนพัง)'
Write-Host ''
Write-Host 'ตรวจหลัง deploy:  curl.exe -i https://<host>:<port>/api/v1/health   → ต้องได้ 200'
Write-Host ''
