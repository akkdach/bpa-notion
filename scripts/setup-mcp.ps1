# ═══════════════════════════════════════════════════════════════════════════
#  ตั้งค่า MCP server ให้ Claude Code เรียกใช้ได้ — ครั้งเดียวจบ
#
#      pwsh scripts/setup-mcp.ps1
#
#  ทำสองอย่าง:
#    1. build mcp/ เป็น Release (.mcp.json ชี้ไปที่ .dll ตัวนั้น)
#    2. สร้าง "บัญชีของ AI" แยกจากบัญชีคุณ เชิญเข้า workspace เป็น member
#       ทำเครื่องหมายว่าเป็น agent แล้วเก็บ credential ลง .NET Secret Manager
#
#  ⚠️ ของเดิมให้ AI ใช้บัญชีเดียวกับเจ้าของ ซึ่งทำให้ last_edited_by เป็นค่าเดียวกัน
#     ทั้งตอนคนแก้และตอน AI แก้ — คำถามว่า "อันนี้ใครแก้" จึงตอบไม่ได้เลย
#     และนั่นทำให้เป้าหมาย "เจ้าของตรวจงานที่ AI ทำได้" เป็นไปไม่ได้ตั้งแต่ต้น
#
#  รหัสผ่านของบัญชี AI ถูกสุ่มและไม่แสดงที่ไหน — ไม่มีใครต้องพิมพ์มันเอง
#  มันอยู่ใน Secret Manager ที่เดียว
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
Write-Host 'บัญชีที่ AI จะใช้' -ForegroundColor Cyan
Write-Host 'สคริปต์จะสร้าง "บัญชีของ AI" แยกจากบัญชีคุณ แล้วเชิญเข้า workspace เป็น member'
Write-Host ''
Write-Host 'ทำไมต้องแยกบัญชี: ถ้า AI ใช้บัญชีเดียวกับคุณ last_edited_by จะเป็นค่าเดียวกัน' -ForegroundColor DarkGray
Write-Host 'ทั้งสองกรณี แล้วคำถามว่า "อันนี้ฉันแก้เองหรือ AI แก้" จะตอบไม่ได้เลย' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'ทำไมเป็น member ไม่ใช่ guest: guest สร้างหน้าระดับบนสุดไม่ได้ AI จะเจอ' -ForegroundColor DarkGray
Write-Host 'Forbidden แล้วลองซ้ำไม่จบ — อยากจำกัดขอบเขตให้ใช้สิทธิ์ระดับหน้า (page ACL)' -ForegroundColor DarkGray
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

$apiUrl = Read-Setting -Key 'Pm:ApiUrl' -Prompt 'URL ของ API' -Default 'http://localhost:5081'
$apiUrl = $apiUrl.TrimEnd('/')
$api = "$apiUrl/api/v1"

# ═══════════════════════════════════════════════════════════════════════════
#  ตัวช่วยเรียก REST
#
#  ⚠️ ต้องระบุ charset=utf-8 ให้ชัด — เนื้อหาทั้งระบบเป็นภาษาไทย ถ้าไม่ระบุ
#     PowerShell บางรุ่นส่งเป็น ISO-8859-1 แล้วชื่อไทยจะเพี้ยนตั้งแต่ตอนสมัคร
#
#  คืน hashtable { ok, data, code, message } แทนการ throw เพราะ 409 (อีเมลถูกใช้
#  แล้ว) เป็นผลลัพธ์ที่คาดไว้ ไม่ใช่ความผิดพลาด
# ═══════════════════════════════════════════════════════════════════════════
function Invoke-Api {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Body,
        [string]$Token,
        [string]$WorkspaceId
    )

    $headers = @{}
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    if ($WorkspaceId) { $headers['X-Workspace-Id'] = $WorkspaceId }

    # ห้ามตั้งชื่อ $args — มันเป็นตัวแปรอัตโนมัติของ PowerShell การประกาศทับ
    # ในฟังก์ชันทำได้แต่ทำให้อ่านยากและเป็นบ่อเกิดของบั๊กที่หาสาเหตุนาน
    $params = @{
        Method      = $Method
        Uri         = "$api$Path"
        Headers     = $headers
        ContentType = 'application/json; charset=utf-8'
        ErrorAction = 'Stop'
    }
    if ($Body) { $params['Body'] = ($Body | ConvertTo-Json -Compress -Depth 5) }

    try {
        $response = Invoke-RestMethod @params
        return @{ ok = $true; data = $response.data }
    } catch {
        $detail = $null
        if ($_.ErrorDetails.Message) {
            $detail = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
        }
        return @{
            ok      = $false
            code    = $detail.code
            message = if ($detail.message) { $detail.message } else { $_.Exception.Message }
        }
    }
}

# ─── 2a. login ด้วยบัญชี "ของคุณ" เพื่อขอสิทธิ์เชิญสมาชิก ──────────────────
Write-Host 'ขั้นแรก: เข้าสู่ระบบด้วยบัญชีของคุณเอง (ต้องเป็น owner หรือ admin)' -ForegroundColor Cyan

$ownerEmail = Read-Host 'อีเมลของคุณ'
$ownerSecure = Read-Host 'รหัสผ่านของคุณ' -AsSecureString
$ownerPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ownerSecure))

$login = Invoke-Api -Method Post -Path '/auth/login' -Body @{
    email = $ownerEmail; password = $ownerPassword
}
if (-not $login.ok) {
    Write-Error "เข้าสู่ระบบไม่สำเร็จ: $($login.message)`nตรวจว่า API รันอยู่ที่ $apiUrl แล้วหรือยัง"
}

$ownerToken = $login.data.accessToken
$ownerWorkspaces = @($login.data.workspaces)

if ($ownerWorkspaces.Count -eq 0) {
    Write-Error 'บัญชีนี้ยังไม่มี workspace — สร้างบนเว็บก่อนแล้วรันสคริปต์นี้อีกครั้ง'
}

# ─── 2b. เลือก workspace ที่ AI จะเข้าถึง ──────────────────────────────────
if ($ownerWorkspaces.Count -eq 1) {
    $target = $ownerWorkspaces[0]
    Write-Host "ใช้ workspace: $($target.name) ($($target.slug))" -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host 'เลือก workspace ที่ AI จะเข้าถึง:' -ForegroundColor Cyan
    for ($i = 0; $i -lt $ownerWorkspaces.Count; $i++) {
        $w = $ownerWorkspaces[$i]
        Write-Host ("  [{0}] {1}  ({2})  สิทธิ์ของคุณ: {3}" -f ($i + 1), $w.name, $w.slug, $w.role)
    }
    $choice = Read-Host "หมายเลข (1-$($ownerWorkspaces.Count))"
    $index = 0
    if (-not [int]::TryParse($choice, [ref]$index) -or $index -lt 1 -or $index -gt $ownerWorkspaces.Count) {
        Write-Error "หมายเลขไม่ถูกต้อง: '$choice'"
    }
    $target = $ownerWorkspaces[$index - 1]
}

if ($target.role -notin @('owner', 'admin')) {
    Write-Error "ต้องเป็น owner หรือ admin ของ '$($target.name)' จึงจะเชิญสมาชิกได้ (คุณเป็น $($target.role))"
}

# ─── 2c. สร้างบัญชีของ AI ──────────────────────────────────────────────────
# อีเมลผูกกับ slug เพื่อให้หลาย workspace มีบอทของตัวเองแยกกันได้
$agentEmail = "claude+$($target.slug)@$($target.slug).local"
$agentName = 'Claude (AI)'

Write-Host ''
Write-Host "บัญชีของ AI: $agentEmail" -ForegroundColor Cyan

# รหัสผ่านสุ่ม — ไม่มีใครต้องพิมพ์มันเอง มันอยู่ใน User Secrets เท่านั้น
$agentPassword = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

$register = Invoke-Api -Method Post -Path '/auth/register' -Body @{
    email = $agentEmail; password = $agentPassword; name = $agentName
}

if ($register.ok) {
    Write-Host '  สมัครบัญชีใหม่ให้ AI แล้ว' -ForegroundColor Green
} elseif ($register.code -eq 'email_taken') {
    # ─────────────────────────────────────────────────────────────────────
    #  มีบัญชีอยู่แล้วจากการรันครั้งก่อน — เราไม่รู้รหัสผ่านเดิม (มันสุ่มและ
    #  เก็บไว้ใน User Secrets เท่านั้น) และไม่มี endpoint รีเซ็ตรหัสผ่าน
    #
    #  ถ้า Pm:Password เดิมยังอยู่ก็ใช้ต่อได้ ถ้าไม่มีต้องบอกให้ชัดว่าต้องทำอะไร
    #  ไม่ใช่เขียนค่าใหม่ทับแล้วปล่อยให้ login ล้มเหลวทีหลังโดยไม่รู้สาเหตุ
    # ─────────────────────────────────────────────────────────────────────
    if ($existing['Pm:Password'] -and $existing['Pm:Email'] -eq $agentEmail) {
        Write-Host '  บัญชีนี้มีอยู่แล้ว — ใช้รหัสผ่านเดิมจาก User Secrets' -ForegroundColor Yellow
        $agentPassword = $null      # null = ไม่เขียนทับค่าที่เก็บไว้
    } else {
        Write-Error @"
บัญชี $agentEmail มีอยู่แล้วแต่ไม่มีรหัสผ่านเก็บไว้ใน User Secrets ของโปรเจกต์นี้

เลือกทางใดทางหนึ่ง:
  · ลบบัญชีนั้นออกจากฐานข้อมูลแล้วรันสคริปต์นี้อีกครั้ง
  · หรือตั้งรหัสผ่านที่ถูกต้องเอง:
      dotnet user-secrets set 'Pm:Email' '$agentEmail' --project mcp
      dotnet user-secrets set 'Pm:Password' '<รหัสผ่านของบัญชีนั้น>' --project mcp
"@
    }
} else {
    Write-Error "สมัครบัญชีให้ AI ไม่สำเร็จ: $($register.message)"
}

# ─── 2d. เชิญเข้า workspace แล้วทำเครื่องหมายว่าเป็น agent ──────────────────
$add = Invoke-Api -Method Post -Path '/workspaces/current/members' -Token $ownerToken `
    -WorkspaceId $target.id -Body @{ email = $agentEmail; role = 'member' }

if ($add.ok) {
    $agentUserId = $add.data.userId
    Write-Host '  เชิญเข้า workspace เป็น member แล้ว' -ForegroundColor Green
} elseif ($add.code -eq 'already_member') {
    Write-Host '  เป็นสมาชิกอยู่แล้ว' -ForegroundColor Yellow
    $members = Invoke-Api -Method Get -Path '/workspaces/current/members' -Token $ownerToken -WorkspaceId $target.id
    if (-not $members.ok) { Write-Error "อ่านรายชื่อสมาชิกไม่ได้: $($members.message)" }
    $agentUserId = ($members.data | Where-Object { $_.email -eq $agentEmail }).userId
    if (-not $agentUserId) { Write-Error "หาบัญชี $agentEmail ในรายชื่อสมาชิกไม่เจอ" }
} else {
    Write-Error "เชิญเข้า workspace ไม่สำเร็จ: $($add.message)"
}

# ทำเครื่องหมายว่าเป็นบัญชีของ AI — owner/admin เท่านั้นที่ตั้งได้ (ดู UpdateMemberRoleRequest)
$mark = Invoke-Api -Method Patch -Path "/workspaces/current/members/$agentUserId" `
    -Token $ownerToken -WorkspaceId $target.id -Body @{ role = 'member'; kind = 'agent' }

if (-not $mark.ok) { Write-Error "ตั้งประเภทบัญชีเป็น agent ไม่สำเร็จ: $($mark.message)" }
Write-Host '  ทำเครื่องหมายว่าเป็นบัญชีของ AI แล้ว' -ForegroundColor Green

# ─── 2e. เก็บลง User Secrets ───────────────────────────────────────────────
# แยกออกมาเป็นตัวแปรก่อน ไม่ส่ง $target.slug ตรง ๆ — property access ใน argument
# position ทำงานถูก แต่ใน "สตริง" ไม่ทำงาน (ได้ 'System.Object.slug') การแยกไว้
# ทำให้ไม่มีใครเผลอเติม quote ทีหลังแล้วพังเงียบ ๆ
$workspaceSlug = $target.slug

dotnet user-secrets init --project $project | Out-Null
dotnet user-secrets set 'Pm:Email' $agentEmail --project $project | Out-Null
dotnet user-secrets set 'Pm:ApiUrl' $apiUrl --project $project | Out-Null
dotnet user-secrets set 'Pm:Workspace' $workspaceSlug --project $project | Out-Null
if ($null -ne $agentPassword) {
    dotnet user-secrets set 'Pm:Password' $agentPassword --project $project | Out-Null
}

Write-Host ''
Write-Host 'ตั้งค่าเรียบร้อย' -ForegroundColor Green
dotnet user-secrets list --project $project | ForEach-Object {
    $k = ($_ -split ' = ', 2)[0]
    $v = ($_ -split ' = ', 2)[1]
    if ($k -eq 'Pm:Password') { Write-Host "  $k = ****" } else { Write-Host "  $k = $v" }
}

Write-Host ''
Write-Host "AI จะทำงานในนาม $agentName ($agentEmail)" -ForegroundColor Cyan
Write-Host "ใน workspace: $($target.name)  ·  สิทธิ์: member"
Write-Host 'ทุกอย่างที่ AI แก้จะถูกบันทึกเป็นการแก้ของบัญชีนี้ ไม่ใช่ของคุณ'
Write-Host ''
Write-Host 'ขั้นต่อไป:' -ForegroundColor Cyan
Write-Host '  1. เปิด API ทิ้งไว้:   dotnet run --project api'
Write-Host '  2. เปิด Claude Code ใหม่ในโฟลเดอร์นี้ แล้วอนุญาต MCP server ชื่อ projectmanagement'
Write-Host '  3. ตรวจด้วยคำสั่ง /mcp — ต้องเห็น projectmanagement เป็น connected'
Write-Host ''
Write-Host 'อยากจำกัดว่า AI เห็นหน้าไหนได้: ใช้สิทธิ์ระดับหน้า (page ACL) กับบัญชีนี้' -ForegroundColor DarkGray
Write-Host 'อย่าลดเป็น guest — guest สร้างหน้าระดับบนสุดไม่ได้ AI จะลองซ้ำไม่จบ' -ForegroundColor DarkGray
Write-Host ''
