# ═══════════════════════════════════════════════════════════════════════════
#  ตั้งค่า MCP server ให้ Claude Code เรียกใช้ได้ — ครั้งเดียวจบ
#
#      pwsh scripts/setup-mcp.ps1
#
#  ทำสองอย่าง:
#    1. build mcp/ เป็น Release (.mcp.json ชี้ไปที่ .dll ตัวนั้น)
#    2. ถามอีเมล/รหัสผ่านของบัญชีในแอป แล้วเก็บลง .NET Secret Manager
#
#  ทำไมไม่ใส่ credential ใน .mcp.json: ไฟล์นั้นขึ้น git ส่วน Secret Manager
#  เก็บที่ %APPDATA%\Microsoft\UserSecrets\<id>\secrets.json ซึ่งอยู่นอก repo
#
#  ทำไมไม่ใช้ env var: ต้องตั้งใหม่ทุก shell และ Claude Code สั่งรัน MCP server
#  เป็น process ลูกที่ไม่ได้สืบทอด env จาก terminal ที่คุณเปิดอยู่เสมอไป
#
#  ⚠️ ไฟล์นี้ต้องเซฟเป็น UTF-8 พร้อม BOM — Windows PowerShell 5.1 อ่าน .ps1
#     ที่ไม่มี BOM เป็น ANSI ทำให้คอมเมนต์ไทยเพี้ยนจน parser พังทั้งไฟล์
#     (ดูเหตุผลเต็มใน scripts/setup-secrets.ps1)
#
#  รันซ้ำได้เสมอ — ทับค่าเดิม
# ═══════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'

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

# ─── 2. credential ────────────────────────────────────────────────────────
Write-Host ''
Write-Host 'บัญชีที่ MCP จะใช้ login เข้าแอป' -ForegroundColor Cyan
Write-Host '(ใช้บัญชีเดียวกับที่คุณเข้าเว็บ — AI จะเห็นและแก้ได้เท่าที่บัญชีนี้เห็นและแก้ได้)'
Write-Host ''

$existing = @{}
dotnet user-secrets list --project $project 2>$null | ForEach-Object {
    $parts = $_ -split ' = ', 2
    if ($parts.Count -eq 2) { $existing[$parts[0]] = $parts[1] }
}

function Read-Setting {
    param([string]$Key, [string]$Prompt, [switch]$Secret, [string]$Default = '')

    $current = $existing[$Key]
    $hint = if ($Secret -and $current) { ' [ตั้งไว้แล้ว — Enter เพื่อคงค่าเดิม]' }
            elseif ($current) { " [$current]" }
            elseif ($Default) { " [$Default]" }
            else { '' }

    if ($Secret) {
        $secure = Read-Host "$Prompt$hint" -AsSecureString
        $value = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    } else {
        $value = Read-Host "$Prompt$hint"
    }

    if ([string]::IsNullOrWhiteSpace($value)) {
        if ($current) { return $null }        # null = ไม่ต้องเขียนทับ
        if ($Default) { return $Default }
        Write-Error "$Key จำเป็นต้องมีค่า"
    }
    return $value
}

$email    = Read-Setting -Key 'Pm:Email'     -Prompt 'อีเมล'
$password = Read-Setting -Key 'Pm:Password'  -Prompt 'รหัสผ่าน' -Secret
$apiUrl   = Read-Setting -Key 'Pm:ApiUrl'    -Prompt 'URL ของ API' -Default 'http://localhost:5081'
$workspace = Read-Host 'workspace (slug หรือ GUID — Enter เพื่อข้ามถ้ามี workspace เดียว)'

dotnet user-secrets init --project $project | Out-Null
if ($null -ne $email)    { dotnet user-secrets set 'Pm:Email' $email --project $project | Out-Null }
if ($null -ne $password) { dotnet user-secrets set 'Pm:Password' $password --project $project | Out-Null }
if ($null -ne $apiUrl)   { dotnet user-secrets set 'Pm:ApiUrl' $apiUrl --project $project | Out-Null }
if (-not [string]::IsNullOrWhiteSpace($workspace)) {
    dotnet user-secrets set 'Pm:Workspace' $workspace --project $project | Out-Null
}

Write-Host ''
Write-Host 'ตั้งค่าเรียบร้อย' -ForegroundColor Green
dotnet user-secrets list --project $project | ForEach-Object {
    $k = ($_ -split ' = ', 2)[0]
    $v = ($_ -split ' = ', 2)[1]
    if ($k -eq 'Pm:Password') { Write-Host "  $k = ****" } else { Write-Host "  $k = $v" }
}

Write-Host ''
Write-Host 'ขั้นต่อไป:' -ForegroundColor Cyan
Write-Host '  1. เปิด API ทิ้งไว้:   dotnet run --project api'
Write-Host '  2. เปิด Claude Code ใหม่ในโฟลเดอร์นี้ แล้วอนุญาต MCP server ชื่อ projectmanagement'
Write-Host '  3. ตรวจด้วยคำสั่ง /mcp — ต้องเห็น projectmanagement เป็น connected'
Write-Host ''
