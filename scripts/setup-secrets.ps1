# ═══════════════════════════════════════════════════════════════════════════
#  ตั้งค่าความลับสำหรับ dev ครั้งเดียวจบ
#
#      pwsh scripts/setup-secrets.ps1
#
#  อ่านค่าจริงจาก .env แล้วเขียนลง .NET Secret Manager ซึ่งเก็บไฟล์ไว้ที่
#  %APPDATA%\Microsoft\UserSecrets\<UserSecretsId>\secrets.json — นอก repo
#
#  ทำไมต้องมี: appsettings.Development.json ขึ้น git จึงใส่ password ไม่ได้
#  เมื่อรันสคริปต์นี้แล้ว `dotnet run` / `dotnet ef` / `dotnet test` ต่อฐานได้
#  ทันทีจากทุก shell โดยไม่ต้อง export env var ก่อน
#
#  รันซ้ำได้เสมอ — ทับค่าเดิม ใช้ตอนเปลี่ยน POSTGRES_PASSWORD ใน .env ด้วย
#
#  ⚠️ ไฟล์นี้ต้องเซฟเป็น UTF-8 *พร้อม BOM*
#     Windows PowerShell 5.1 อ่าน .ps1 ที่ไม่มี BOM เป็น ANSI codepage ทำให้
#     คอมเมนต์ภาษาไทยเพี้ยนจนเครื่องหมาย ' ' ไม่ครบคู่ แล้ว parser พังทั้งไฟล์
#     ด้วย error ที่ชี้ไปผิดบรรทัด ("Missing closing '}'")  — pwsh 7 ไม่มีปัญหานี้
#     แก้: [IO.File]::WriteAllText($p, $text, [Text.UTF8Encoding]::new($true))
# ═══════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$project = Join-Path $root 'api'

if (-not (Test-Path $envFile)) {
    Write-Error "ไม่พบ .env — รัน: Copy-Item .env.example .env แล้วตั้งค่าก่อน"
}

# ─────────────────────────────────────────────────────────────────────────
#  อ่าน .env เอง ไม่ใช้ Invoke-Expression — ค่าใน .env ต้องไม่กลายเป็นคำสั่ง
#  (password ที่มี ; หรือ $ อยู่ข้างในเป็นเรื่องปกติ)
# ─────────────────────────────────────────────────────────────────────────
function Read-EnvValue([string]$Key, [string]$Default = '') {
    $line = Select-String -Path $envFile -Pattern "^$([regex]::Escape($Key))=" |
            Select-Object -Last 1
    if ($null -eq $line) { return $Default }
    return $line.Line.Substring($Key.Length + 1)
}

$password = Read-EnvValue 'POSTGRES_PASSWORD'
$jwtSecret = Read-EnvValue 'JWT_SECRET'
$hostPort = Read-EnvValue 'POSTGRES_HOST_PORT' '5440'
$database = Read-EnvValue 'POSTGRES_DB' 'projectmanagement'

if ([string]::IsNullOrWhiteSpace($password)) { Write-Error 'POSTGRES_PASSWORD ว่างใน .env' }
if ([string]::IsNullOrWhiteSpace($jwtSecret)) { Write-Error 'JWT_SECRET ว่างใน .env' }

dotnet user-secrets init --project $project | Out-Null

# ⚠️ ส่งค่าแบบ argument list ไม่ใช่ string เดียว — password ที่มีช่องว่างหรือ
#    อักขระพิเศษจะถูก PowerShell แตกเป็นหลาย argument ถ้าประกอบเป็นบรรทัดเอง
dotnet user-secrets set 'Postgres:Password' $password --project $project | Out-Null
dotnet user-secrets set 'Jwt:Key' $jwtSecret --project $project | Out-Null

Write-Host ''
Write-Host '✓ ตั้งค่า user secrets เรียบร้อย' -ForegroundColor Green
Write-Host "  Postgres:Password  ← POSTGRES_PASSWORD ($($password.Length) ตัวอักษร)"
Write-Host "  Jwt:Key            ← JWT_SECRET ($($jwtSecret.Length) ตัวอักษร)"
Write-Host ''
Write-Host "  connection string ที่จะได้:  Host=localhost;Port=$hostPort;Database=$database;Username=$(Read-EnvValue 'POSTGRES_USER' 'postgres')"
Write-Host '  (host/port/database อยู่ใน api/appsettings.Development.json — ไม่ใช่ความลับ)'
Write-Host ''
Write-Host '  ต่อไปนี้รันได้เลยโดยไม่ต้อง export อะไร:'
Write-Host '      cd api; dotnet run'
Write-Host '      dotnet ef database update --project api'
Write-Host ''
