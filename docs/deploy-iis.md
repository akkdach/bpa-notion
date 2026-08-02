# Deploy บน IIS (Windows Server)

คู่มือหลักของโปรเจกต์คือ docker compose ([README](../README.md)) — ไฟล์นี้สำหรับกรณีที่ปลายทาง
เป็น **IIS** ซึ่งต่างกันหลายเรื่องพอที่จะทำให้ทำตาม README ตรง ๆ แล้วพัง

> ⚠️ PostgreSQL + PGroonga **ไม่ได้มากับ IIS** ต้องลงแยกเสมอ — ดูหัวข้อ "ฐานข้อมูล" ล่างสุด

---

## 0. ของที่ต้องมีบนเครื่องก่อน

| ของ | ทำไม |
|---|---|
| **ASP.NET Core Hosting Bundle (.NET 10)** | ไม่ใช่แค่ Runtime — มันติดตั้ง `AspNetCoreModuleV2` ที่ `web.config` อ้างถึง ไม่มีแล้วได้ **500.19** หรือ **502.5** · ติดตั้งเสร็จต้อง `iisreset` |
| **URL Rewrite Module** | ให้ SPA เปิดหน้าลึกแล้วกด F5 ไม่ 404 |
| **Application Request Routing (ARR)** | เฉพาะเมื่อ SPA กับ API อยู่คนละ site แล้วต้อง proxy `/api` |
| **PostgreSQL 18 + PGroonga** | ไม่มี PGroonga = ค้นหาภาษาไทยพัง |

---

## 1. ⚠️ App Pool ต้องเป็น 64-bit

`YDotNet.Native.Win32` แพ็ก native มาแค่ **`win-x64`** และ `win-arm64` — **ไม่มี `win-x86`**

ถ้า App Pool ตั้ง *Enable 32-Bit Applications = True* → `yrs.dll` โหลดไม่ขึ้น →
`append_content` (รวมผังงาน mermaid) พังด้วย `DllNotFoundException` ตอน runtime
**ส่วนอย่างอื่นทำงานปกติหมด** จึงเป็นอาการที่หาสาเหตุยากที่สุดในเอกสารนี้

```powershell
Import-Module WebAdministration
Set-ItemProperty IIS:\AppPools\<ชื่อ pool> -Name enable32BitAppOnWin64 -Value $false
```

ตรวจว่าตั้งถูก:

```powershell
(Get-ItemProperty IIS:\AppPools\<ชื่อ pool>).enable32BitAppOnWin64   # ต้องได้ False
```

---

## 2. Publish

```powershell
cd D:\Projects\notion\api
dotnet publish -c Release -o publish
```

เอาทั้งโฟลเดอร์ `publish\` ไปวางที่ physical path ของ site

`web.config` มาจาก [`api/web.config`](../api/web.config) ที่เก็บใน git — csproj ตั้ง
`IsTransformWebConfigDisabled` ไว้ ไม่ให้ SDK สร้างทับ (ค่าเริ่มต้นมันจะ generate ใหม่
ทุกครั้งแล้วลบทุกอย่างที่ตั้งไว้ทิ้งเงียบ ๆ — deploy รอบสองแล้วแอปพังทั้งที่ไม่ได้แก้โค้ด)

---

## 3. ความลับ — ตั้งที่ App Pool ไม่ใช่ใน web.config

`web.config` ขึ้น git จึงใส่ความลับไม่ได้ ส่วน environment variable ระดับ **application pool**
เก็บใน `applicationHost.config` ซึ่ง **อยู่รอดข้าม deploy** ด้วย

```powershell
$pool = '<ชื่อ pool>'
$appcmd = "$env:windir\system32\inetsrv\appcmd.exe"

# สุ่ม Jwt:Key บนเครื่องนี้ (ใช้ได้ทั้ง PowerShell 5.1 และ 7)
$b = [byte[]]::new(48)
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$jwtKey = [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_')

& $appcmd set config -section:applicationPools `
  "/+[name='$pool'].environmentVariables.[name='Jwt__Key',value='$jwtKey']" /commit:apphost

& $appcmd set config -section:applicationPools `
  "/+[name='$pool'].environmentVariables.[name='ConnectionStrings__DefaultConnection',value='Host=localhost;Port=5432;Database=projectmanagement;Username=postgres;Password=<รหัสจริง>']" /commit:apphost
```

จากนั้น recycle:

```powershell
Restart-WebAppPool -Name $pool
```

> **ทั้งสองตัวไม่มีค่า = API start ไม่ขึ้น** โดยเจตนา — `AuthConfiguration` และ
> `CorsConfiguration` throw ตั้งแต่ตอน start พร้อมข้อความบอกสาเหตุ ดีกว่าปล่อยให้ไปพัง
> ตอนผู้ใช้กด login

⚠️ **อย่าใช้ `Get-Random` หรือ `New-Guid` สร้างคีย์** — ไม่ใช่ CSPRNG
คีย์ต้องยาวอย่างน้อย **32 bytes** (บังคับใน `AuthConfiguration`)

---

## 4. ⚠️ CORS ใช้ `*` ไม่ได้

`AllowAnyOrigin()` + `AllowCredentials()` (ที่ SignalR ต้องมี) อยู่ด้วยกันไม่ได้ —
ASP.NET Core throw ตอน runtime และมี CI gate ห้ามเขียนไว้แล้ว

ตั้ง origin ตรง ๆ ใน `web.config`:

```xml
<environmentVariable name="Cors__AllowedOrigins__0" value="https://service.bevproasia.com" />
```

ใส่แค่ **scheme + host (+ port)** — ห้ามมี path ห้ามมี `/` ปิดท้าย

หลาย origin ก็เพิ่ม `__1`, `__2` ต่อไป

> ถ้า SPA กับ API อยู่โดเมนเดียวกัน CORS จะไม่ทำงานเลย (ไม่มี preflight)
> **เจอ CORS error แปลว่าโครง proxy ยังไม่ถูก — แก้ที่นั่น อย่าไปหา `*`**

---

## 5. ฝั่งเว็บ (SPA)

```powershell
cd D:\Projects\notion\web
npm run build:prod      # อ่าน web/.env.production
```

เอา `web\dist\` ไปวางที่ site ของ SPA

⚠️ **`VITE_*` เป็น build-time** ค่าถูกฝังลง bundle ตอน build — แก้ `.env.production`
แล้วต้อง build ใหม่เสมอ restart IIS ไม่มีผล

### SPA fallback — IIS ไม่มี `try_files`

ต้องมี `web.config` ที่โฟลเดอร์ SPA ไม่งั้นเปิด `/p/<id>` แล้วกด F5 จะได้ 404:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- ปล่อยไฟล์จริงและ /api /hubs ผ่านไป ที่เหลือส่งเข้า index.html -->
        <rule name="SPA" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
            <add input="{REQUEST_URI}" pattern="^/(api|hubs)/" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

### `/api` ต้องไปถึง API

`VITE_API_BASE_URL=/api/v1` เป็น path แบบ same-origin — ถ้า API เป็นคนละ site
ต้องใช้ **ARR + rewrite** proxy ให้ ไม่งั้น request จะตกลง SPA fallback แล้วได้
**HTML 200 แทน JSON** ซึ่งดีบั๊กยากมาก (เห็นเป็น "JSON parse error" ที่ไม่บอกอะไร)

---

## 6. ฐานข้อมูล

IIS ไม่เกี่ยวกับ Postgres — ต้องทำสามอย่างนี้เอง

```powershell
# 1. extension (ครั้งเดียวต่อฐาน) — db/init/*.sql
#    ถ้าไม่ลง PGroonga การค้นหาภาษาไทยจะพัง
psql -U postgres -d projectmanagement -f db\init\001_extensions.sql

# 2. schema
cd D:\Projects\notion
dotnet ef database update --project api

# 3. index ของ PGroonga
psql -U postgres -d projectmanagement -f api\Data\Migrations\Sql\003_pgroonga_indexes.sql
```

---

## 7. ตรวจว่าขึ้นจริง

```powershell
curl.exe -i https://<โดเมน>/api/v1/health
```

ต้องได้ **200 พร้อม JSON** — ถ้าได้ HTML แปลว่า request ไม่ถึง API (ตกลง SPA fallback)

**start ไม่ขึ้น (500.30 / 502.5)** → อ่าน `publish\logs\stdout*.log`
เป็นที่เดียวที่บอกว่า throw เพราะอะไร

⚠️ ต้อง **สร้างโฟลเดอร์ `logs\` เองและให้ app pool identity เขียนได้**
ไม่งั้นไม่มีไฟล์ออกมาเลย แล้วจะเข้าใจผิดว่า "ไม่มี error"
เสร็จแล้วเปลี่ยน `stdoutLogEnabled` กลับเป็น `false` (ไฟล์โตเรื่อย ๆ ไม่มีการหมุน)

---

## 8. ต่อ MCP จากเครื่องลูกค้า

MCP server เป็น **stdio** รันบนเครื่องลูกค้าเอง แล้ววิ่ง HTTPS **ขาออก** มาหา API
— ไม่ต้องเปิดพอร์ตอะไรเพิ่มบน server และไม่เกี่ยวกับ CORS

ที่เครื่องลูกค้า:

```powershell
pwsh scripts\setup-mcp.ps1
```

| ค่า | ใส่อะไร |
|---|---|
| `Pm:ApiUrl` | `https://service.bevproasia.com` — **base origin เท่านั้น** |
| `Pm:Token` | token จากหน้า **ตั้งค่า → การเชื่อมต่อ AI** |

⚠️ `Pm:ApiUrl` **ห้ามใส่ `/api/v1`** — `PmClient` ต่อให้เองแล้ว ใส่ซ้ำจะกลายเป็น
`/api/v1/api/v1/pages` → 404 (ต่างจาก `VITE_API_BASE_URL` ฝั่งเว็บที่ต้องมี — สับสนกันบ่อย)

ดูคู่มือสำหรับลูกค้าเต็ม ๆ ที่ [docs/connect-ai.md](connect-ai.md)
