# ═══════════════════════════════════════════════════════════════════════════
#  ตั้งค่า MCP server ให้ Claude Code เรียกใช้ได้ — ครั้งเดียวจบ
#
#      pwsh scripts/setup-mcp.ps1                    (PowerShell 7)
#      powershell -File scripts\setup-mcp.ps1        (Windows PowerShell 5.1 ที่ติดมากับ Windows)
#
#  ⚠️ `pwsh` คือ PowerShell 7 ซึ่ง "ไม่ได้ติดมากับ Windows" — เครื่องที่ยังไม่ได้
#     ลงจะขึ้น "'pwsh' is not recognized" ให้ใช้บรรทัดที่สองแทน สคริปต์นี้รันได้
#     ทั้งสองรุ่น (ไฟล์เซฟเป็น UTF-8 พร้อม BOM แล้ว 5.1 จึงอ่านคอมเมนต์ไทยถูก)
#
#  ทำสองอย่าง:
#    1. build mcp/ เป็น Release (.mcp.json ชี้ไปที่ .dll ตัวนั้น)
#    2. รับ API token ที่คุณสร้างจากหน้าเว็บ ตรวจว่าใช้ได้จริง แล้วเก็บลง
#       .NET Secret Manager
#
#  ⚠️ ต้องมี token ก่อนรันสคริปต์นี้ — สร้างที่
#     เว็บ → ตั้งค่า → การเชื่อมต่อ AI → สร้าง token
#     ค่าจริงแสดงครั้งเดียว คัดลอกมาวางที่นี่
#
#  ─────────────────────────────────────────────────────────────────────────
#  ทำไมเปลี่ยนจากอีเมล/รหัสผ่านมาเป็น token
#
#  ของเดิมสคริปต์นี้สมัครบัญชี AI ให้เอง แล้วเก็บ "รหัสผ่าน" ไว้ให้ MCP login
#  ซึ่งมีปัญหาสามข้อที่แก้ไม่ได้ด้วยการเขียนสคริปต์ให้ดีขึ้น:
#
#    · ถอนสิทธิ์เครื่องเดียวไม่ได้ — รหัสผ่านคือใบเดียวของทั้งบัญชี
#    · ตั้งเครื่องที่สองไม่ได้ — รันสคริปต์ซ้ำเจอ email_taken แล้วตัน เพราะ
#      รหัสผ่านเดิมสุ่มไว้และอยู่ใน Secret Manager ของเครื่องแรกเท่านั้น
#    · ไม่รู้ว่าเครื่องไหนใช้อยู่ ครั้งสุดท้ายเมื่อไหร่
#
#  token แก้ได้ทั้งสามข้อ: หนึ่งเครื่องหนึ่งใบ เพิกถอนรายใบ มี last_used_at
#  และบัญชี agent ถูกสร้างฝั่งเซิร์ฟเวอร์ตอนออก token ใบแรก — สคริปต์นี้จึงไม่
#  ต้องรู้จักรหัสผ่านของใครอีกเลย
#  ─────────────────────────────────────────────────────────────────────────
#
#  ทำไมไม่ใส่ token ใน .mcp.json: ไฟล์นั้นขึ้น git ส่วน Secret Manager เก็บที่
#  %APPDATA%\Microsoft\UserSecrets\<id>\secrets.json ซึ่งอยู่นอก repo
#
#  ทำไมไม่ใช้ env var: ต้องตั้งใหม่ทุก shell และ Claude Code สั่งรัน MCP server
#  เป็น process ลูกที่ไม่ได้สืบทอด env จาก terminal ที่คุณเปิดอยู่เสมอไป
#  (ถ้าจะใช้จริง ๆ ตัวแปรคือ PM_TOKEN กับ PM_API_URL)
#
#  ⚠️ ไฟล์นี้ต้องเซฟเป็น UTF-8 พร้อม BOM — Windows PowerShell 5.1 อ่าน .ps1
#     ที่ไม่มี BOM เป็น ANSI ทำให้คอมเมนต์ไทยเพี้ยนจน parser พังทั้งไฟล์
#     (ดูเหตุผลเต็มใน scripts/setup-secrets.ps1)
#
#  รันซ้ำได้เสมอ — ทับค่าเดิม
# ═══════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'

# ⚠️ Windows PowerShell 5.1 บางเครื่องยังต่อ HTTPS ด้วย TLS 1.0 เป็นค่าเริ่มต้น
#    ทำให้ Invoke-RestMethod ล้มด้วย "could not create SSL/TLS secure channel"
#    ซึ่งอ่านแล้วเดาไม่ออกว่าเป็นเรื่อง TLS — บังคับ 1.2 ไว้ก่อนเลย
if ($PSVersionTable.PSVersion.Major -lt 6) {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'mcp'
$csproj = Join-Path $project 'ProjectManagementMcp.csproj'

if (-not (Test-Path $csproj)) { Write-Error "ไม่พบ $csproj" }

# ─── 1. build ─────────────────────────────────────────────────────────────
Write-Host ''
Write-Host 'กำลัง build MCP server...' -ForegroundColor Cyan
dotnet build $csproj -c Release -v q --nologo
if ($LASTEXITCODE -ne 0) { Write-Error 'build ไม่ผ่าน' }

$dll = Join-Path $project 'bin\Release\net10.0\ProjectManagementMcp.dll'
if (-not (Test-Path $dll)) { Write-Error "build ผ่านแต่ไม่พบ $dll" }

# ─── 2. ค่าที่มีอยู่เดิม ───────────────────────────────────────────────────
$existing = @{}
dotnet user-secrets list --project $project 2>$null | ForEach-Object {
    $parts = $_ -split ' = ', 2
    if ($parts.Count -eq 2) { $existing[$parts[0]] = $parts[1] }
}

Write-Host ''
Write-Host 'การเชื่อมต่อ' -ForegroundColor Cyan

# ⚠️ ค่าเริ่มต้นคือระบบจริงบน NAS ไม่ใช่ localhost — คนส่วนใหญ่ที่รันสคริปต์นี้
#    ต้องการต่อระบบจริง ส่วน localhost:5081 ใช้เฉพาะตอนพัฒนาโดยเปิด dev server เอง
$defaultApiUrl = 'https://maps.bevproasia.com:4090'
$apiHint = if ($existing['Pm:ApiUrl']) { " [$($existing['Pm:ApiUrl'])]" } else { " [$defaultApiUrl]" }
Write-Host "ระบบจริง: $defaultApiUrl  ·  dev ในเครื่อง: http://localhost:5081" -ForegroundColor DarkGray
$apiUrl = Read-Host "URL ของ API$apiHint"
if ([string]::IsNullOrWhiteSpace($apiUrl)) {
    $apiUrl = if ($existing['Pm:ApiUrl']) { $existing['Pm:ApiUrl'] } else { $defaultApiUrl }
}
$apiUrl = $apiUrl.TrimEnd('/')
$api = "$apiUrl/api/v1"

# ─── 3. รับ token ─────────────────────────────────────────────────────────
Write-Host ''
Write-Host 'API token' -ForegroundColor Cyan
Write-Host 'สร้างที่: เว็บ → ตั้งค่า → การเชื่อมต่อ AI → สร้าง token' -ForegroundColor DarkGray
Write-Host 'ค่าจริงแสดงครั้งเดียวตอนสร้าง ถ้าทำหายให้ออกใบใหม่ (ใบเก่าเพิกถอนทิ้งได้)' -ForegroundColor DarkGray
Write-Host ''

$keepExisting = $false
$tokenHint = if ($existing['Pm:Token']) { ' [ตั้งไว้แล้ว — Enter เพื่อคงค่าเดิม]' } else { '' }
$tokenSecure = Read-Host "วาง token ที่นี่$tokenHint" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($tokenSecure))

if ([string]::IsNullOrWhiteSpace($token)) {
    if (-not $existing['Pm:Token']) {
        Write-Error 'ต้องมี token — สร้างที่หน้า ตั้งค่า → การเชื่อมต่อ AI แล้วรันสคริปต์นี้อีกครั้ง'
    }
    $token = $existing['Pm:Token']
    $keepExisting = $true
}

$token = $token.Trim()

# ตรวจ prefix ก่อนยิงเน็ต — คนวางผิดช่อง (เช่นวาง JWT จาก devtools) จะได้เห็น
# ข้อความที่บอกสาเหตุจริง แทน 401 ที่อ่านแล้วเดาไม่ออกว่าพลาดตรงไหน
if (-not $token.StartsWith('pmt_')) {
    Write-Error @"
ค่านี้ไม่ใช่ API token ของระบบนี้ — token ที่ถูกต้องขึ้นต้นด้วย 'pmt_'

ถ้าคุณคัดลอกมาจาก devtools หรือจากที่อื่น นั่นคือ access token ของเบราว์เซอร์
ซึ่งหมดอายุใน 15 นาทีและใช้กับ MCP ไม่ได้ — ให้สร้างใบใหม่ที่
เว็บ → ตั้งค่า → การเชื่อมต่อ AI
"@
}

# ─── 4. ตรวจว่าใช้ได้จริง ─────────────────────────────────────────────────
# ⚠️ ต้องยิงจริงหนึ่งครั้งก่อนเก็บ ไม่งั้น token ผิดจะไปโผล่ตอน Claude Code
#    เรียก tool แล้วได้ข้อความ error กลางบทสนทนา ซึ่งเป็นที่ที่แย่ที่สุดในการ
#    รู้ว่าตั้งค่าพลาด
Write-Host ''
Write-Host 'กำลังตรวจ token...' -ForegroundColor Cyan

try {
    $me = Invoke-RestMethod -Method Get -Uri "$api/workspaces/current" `
        -Headers @{ Authorization = "Bearer $token" } `
        -ContentType 'application/json; charset=utf-8' -ErrorAction Stop
} catch {
    $detail = $null
    if ($_.ErrorDetails.Message) {
        $detail = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    }
    $reason = if ($detail.message) { $detail.message } else { $_.Exception.Message }

    Write-Error @"
ใช้ token นี้ไม่ได้: $reason

ตรวจตามลำดับ:
  1. API รันอยู่ที่ $apiUrl หรือยัง  (dotnet run --project api)
  2. token ถูกเพิกถอนหรือหมดอายุไปแล้วหรือเปล่า — ดูที่หน้า ตั้งค่า → การเชื่อมต่อ AI
  3. คัดลอกมาครบทั้งบรรทัดหรือไม่ (มันยาวกว่าที่ตาเห็นในช่องแสดงผล)
"@
}

$workspace = $me.data
Write-Host "  ใช้ได้ — ผูกกับ workspace: $($workspace.name)" -ForegroundColor Green

# ─── 5. เก็บลง User Secrets ───────────────────────────────────────────────
dotnet user-secrets init --project $project | Out-Null
dotnet user-secrets set 'Pm:ApiUrl' $apiUrl --project $project | Out-Null
if (-not $keepExisting) {
    dotnet user-secrets set 'Pm:Token' $token --project $project | Out-Null
}

# ─────────────────────────────────────────────────────────────────────────
#  ลบค่าแบบเก่าทิ้ง
#
#  Pm:Email / Pm:Password — MCP ไม่อ่านแล้ว แต่ถ้าปล่อยค้างไว้ก็เท่ากับทิ้ง
#  รหัสผ่านของบัญชีจริงไว้บนดิสก์โดยไม่มีใครใช้ ซึ่งไม่มีเหตุผลจะเก็บ
#
#  Pm:Workspace — เดิม MCP ส่ง slug นี้เป็น X-Workspace-Id เอง ตอนนี้ขอบเขต
#  มากับตัว token แล้ว ถ้าปล่อยค้างไว้จะชวนเข้าใจผิดว่าแก้ค่านี้แล้วสลับ
#  workspace ได้ (แก้ไม่ได้ — ต้องออก token ใบใหม่ใน workspace นั้น)
# ─────────────────────────────────────────────────────────────────────────
foreach ($stale in @('Pm:Email', 'Pm:Password', 'Pm:Workspace')) {
    if ($existing.ContainsKey($stale)) {
        dotnet user-secrets remove $stale --project $project | Out-Null
        Write-Host "  ลบค่าแบบเก่า $stale ทิ้งแล้ว" -ForegroundColor DarkGray
    }
}

# ─────────────────────────────────────────────────────────────────────────
#  6. ลงทะเบียน MCP server กับ Claude Code แบบ user scope
#
#  ⚠️ ขั้นนี้เคยขาดไป แล้วทำให้เข้าใจผิดกันบ่อย: สคริปต์ตั้ง token ให้เรียบร้อย
#     แต่ Claude Code ยังไม่รู้จัก server เลย มันรู้จักจาก .mcp.json ในโปรเจกต์นี้
#     เท่านั้น — ซึ่งอ่านเฉพาะตอนเปิด Claude Code "ในโฟลเดอร์นี้" และ path ใน
#     ไฟล์นั้นเป็นแบบสัมพัทธ์ พอไปเปิดในโปรเจกต์อื่นจึงไม่มี MCP ให้ใช้
#
#  user scope + path เต็ม = ใช้ได้ทุกโฟลเดอร์บนเครื่องนี้
#  รันซ้ำได้: ถอนของเดิมก่อนเสมอ (ไม่มีอยู่ก็ไม่เป็นไร)
# ─────────────────────────────────────────────────────────────────────────
Write-Host ''
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Host 'กำลังลงทะเบียนกับ Claude Code (user scope)...' -ForegroundColor Cyan
    claude mcp remove projectmanagement -s user 2>$null | Out-Null
    claude mcp add --scope user projectmanagement -- dotnet $dll 2>&1 | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Host '  ลงทะเบียนแล้ว — เรียกใช้ได้จากทุกโฟลเดอร์' -ForegroundColor Green
    } else {
        Write-Host '  ลงทะเบียนไม่สำเร็จ — สั่งเองได้ด้วย:' -ForegroundColor Yellow
        Write-Host "    claude mcp add --scope user projectmanagement -- dotnet `"$dll`"" -ForegroundColor Yellow
    }
} else {
    Write-Host 'ไม่พบคำสั่ง claude — ข้ามการลงทะเบียน' -ForegroundColor Yellow
    Write-Host 'ติดตั้ง Claude Code แล้วสั่งเองด้วย:' -ForegroundColor Yellow
    Write-Host "  claude mcp add --scope user projectmanagement -- dotnet `"$dll`"" -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'ตั้งค่าเรียบร้อย' -ForegroundColor Green
dotnet user-secrets list --project $project | ForEach-Object {
    $k = ($_ -split ' = ', 2)[0]
    $v = ($_ -split ' = ', 2)[1]
    if ($k -eq 'Pm:Token') { Write-Host "  $k = pmt_****$($v.Substring($v.Length - 4))" }
    else { Write-Host "  $k = $v" }
}

Write-Host ''
Write-Host "AI จะทำงานใน workspace: $($workspace.name)" -ForegroundColor Cyan
Write-Host 'ทุกอย่างที่ AI แก้ถูกบันทึกในนามบัญชี agent ไม่ใช่บัญชีของคุณ'
Write-Host 'ดูย้อนหลังได้ที่หน้า ตรวจงาน → ฟีดกิจกรรม'
Write-Host ''
Write-Host 'ขั้นต่อไป:' -ForegroundColor Cyan
if ($apiUrl -like '*localhost*') {
    Write-Host '  1. เปิด dev server ทิ้งไว้:   npm --prefix server run dev'
} else {
    Write-Host "  1. ไม่ต้องเปิดอะไรเพิ่ม — $apiUrl รันอยู่ตลอดเวลา"
}
Write-Host '  2. ปิด Claude Code แล้วเปิดใหม่ (ทุกโฟลเดอร์ใช้ได้ ไม่จำเป็นต้องอยู่ในโปรเจกต์นี้)'
Write-Host '  3. ตรวจด้วยคำสั่ง /mcp — ต้องเห็น projectmanagement เป็น connected'
Write-Host ''
Write-Host 'หมายเหตุ: ถ้าเปิด Claude Code ในโฟลเดอร์โปรเจกต์นี้ อาจขึ้นเตือน' -ForegroundColor DarkGray
Write-Host '"Conflicting scopes" เพราะมี .mcp.json ของโปรเจกต์ซ้ำกับที่เพิ่งลงทะเบียน' -ForegroundColor DarkGray
Write-Host 'ไม่กระทบการใช้งาน — ตัว user scope ถูกใช้จริง' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'เครื่องอื่นที่จะใช้ด้วย: ออก token คนละใบ อย่าใช้ใบเดียวกันสองเครื่อง' -ForegroundColor DarkGray
Write-Host 'จะได้รู้ว่าเครื่องไหนใช้อยู่ และเพิกถอนทีละเครื่องได้เมื่อเครื่องหาย' -ForegroundColor DarkGray
Write-Host ''
