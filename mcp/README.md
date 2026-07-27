# MCP server — ให้ Claude Code สั่งงานแอปได้

MCP server แบบ stdio ที่ครอบ REST API ของ `api/` ให้ Claude Code เรียกเป็น tool
ได้โดยตรง คุยกับ API ผ่าน HTTP เหมือน client ทั่วไป **ไม่แตะฐานข้อมูลเอง** จึงได้
tenant isolation, permission check และ validation ชุดเดียวกับที่เว็บได้

```
Claude Code  ──stdio/JSON-RPC──▶  ProjectManagementMcp  ──HTTP──▶  api/  ──▶  PostgreSQL
```

---

## ตั้งค่าครั้งแรก

```powershell
pwsh scripts/setup-mcp.ps1
```

สคริปต์จะ build เป็น Release แล้ว **สร้างบัญชีของ AI แยกจากบัญชีคุณ**:

1. ถามอีเมล/รหัสผ่าน **ของคุณ** (ต้องเป็น owner/admin) เพื่อขอสิทธิ์เชิญสมาชิก
2. ให้เลือก workspace ที่ AI จะเข้าถึง
3. สมัครบัญชี `claude+<slug>@<slug>.local` ด้วยรหัสผ่านสุ่ม
4. เชิญเข้า workspace เป็น **member** แล้วทำเครื่องหมาย `kind = agent`
5. เก็บ credential ของบัญชี AI ลง
   [.NET Secret Manager](https://learn.microsoft.com/aspnet/core/security/app-secrets)
   ที่ `%APPDATA%\Microsoft\UserSecrets\` — **นอก repo**

จากนั้น

1. เปิด API ทิ้งไว้ — `dotnet run --project api`
2. เปิด Claude Code ใหม่ในโฟลเดอร์ `d:/Projects/notion` แล้วอนุญาต MCP server ชื่อ `projectmanagement`
3. ตรวจด้วย `/mcp` — ต้องเห็นสถานะ connected

### ทำไม AI ต้องมีบัญชีของตัวเอง

ของเดิมให้ AI ใช้บัญชีเดียวกับเจ้าของ ผลคือ `pages.last_edited_by` เป็นค่าเดียวกัน
ทั้งตอนคนแก้และตอน AI แก้ — คำถามว่า **"อันนี้ฉันแก้เองหรือ AI แก้"** จึงตอบไม่ได้เลย
ซึ่งทำให้เป้าหมาย "เจ้าของตรวจงานที่ AI ทำได้ง่าย" เป็นไปไม่ได้ตั้งแต่ต้น

`users.kind` (`human` / `agent`) **ไม่ใช่ระดับสิทธิ์** — agent ได้สิทธิ์จาก
`workspace_members` เหมือนคนทุกอย่าง และ**ตั้งเองตอนสมัครไม่ได้** ต้องให้ owner/admin
เป็นคนยืนยันผ่าน `PATCH /workspaces/current/members/{userId}` ถ้าใครตั้งเองได้ ก็ปลอมให้
การแก้ของตัวเองดูเหมือน AI ทำ (หรือกลับกัน) ได้ ซึ่งทำลายจุดประสงค์ทั้งหมด

> **role ต้องเป็น `member` ไม่ใช่ `guest`** — guest สร้างหน้าระดับบนสุดไม่ได้
> ([PageTreeService](../api/Services/PageTreeService.cs)) AI จะเจอ Forbidden แล้วลองซ้ำไม่จบ
> อยากจำกัดขอบเขตให้ใช้สิทธิ์ระดับหน้า (page ACL) กับบัญชีนั้น

## config

อ่านจากสองที่ **User Secrets ชนะ env var**

| User Secrets | env var | ค่าเริ่มต้น |
|---|---|---|
| `Pm:ApiUrl` | `PM_API_URL` | `http://localhost:5081` |
| `Pm:Email` | `PM_EMAIL` | *(จำเป็น)* — อีเมลของบัญชี **AI** ไม่ใช่ของคุณ |
| `Pm:Password` | `PM_PASSWORD` | *(จำเป็น)* — รหัสผ่านสุ่มที่ setup-mcp ตั้งให้ |
| `Pm:Workspace` | `PM_WORKSPACE` | ข้ามได้ถ้าบัญชีมี workspace เดียว |

env var มีไว้สำหรับ container / CI ที่ไม่มี secret store ส่วนบนเครื่อง dev ใช้
User Secrets เพราะไม่ต้องตั้งใหม่ทุก shell และ **Claude Code สั่งรัน MCP server
เป็น process ลูกที่ไม่ได้สืบทอด env จาก terminal ที่คุณเปิดอยู่เสมอไป**

> ⚠️ `Host.CreateApplicationBuilder` โหลด Secret Manager ให้เฉพาะตอน environment
> เป็น Development เท่านั้น MCP ถูกสั่งรันโดยไม่มี `DOTNET_ENVIRONMENT` จึงตกเป็น
> Production — `Program.cs` จึงเรียก `AddUserSecrets` เองอย่างชัดเจน ไม่งั้น secret
> จะหายไปเงียบ ๆ แล้วขึ้นว่า "ยังไม่ได้ตั้ง Pm:Email" ทั้งที่ตั้งไปแล้ว

## tools ที่มี

โมเดล: **โปรเจกต์ = หน้าระดับบนสุด, งาน = หน้าลูกใต้โปรเจกต์** สถานะเก็บใน
`pages.status` (`todo` / `doing` / `done`, `null` = ไม่ใช่งาน)

| tool | ทำอะไร |
|---|---|
| `list_projects` | โปรเจกต์ทั้งหมด พร้อมจำนวนงานค้าง |
| `list_tasks` | งานใต้โปรเจกต์ กรองด้วย status ได้ ซ่อน done เป็นค่าเริ่มต้น |
| `get_task` | รายละเอียดหน้าหนึ่ง พร้อมงานลูก |
| `create_project` | สร้างหน้าระดับบนสุด |
| `create_task` | สร้างหน้าลูกพร้อมสถานะ |
| `update_task` | เปลี่ยนชื่อ / สถานะ / ไอคอน |
| `complete_task` | ตั้งสถานะเป็น done |

> `create_task` เป็น **คำขอเดียว** แล้ว — `POST /pages` รับ `status` ตอนสร้าง
> (`CreatePageRequest.Status`) ของเดิมยิง POST แล้ว PATCH ตาม ซึ่งล้มกลางทางแล้ว
> เหลือหน้าที่ไม่มีสถานะค้างอยู่
>
> รายการสถานะที่อนุญาต **ไม่มีสำเนาใน `mcp/` อีกแล้ว** — แหล่งความจริงคือ
> `api/Domain/PageStatus.cs` กับ constraint `ck_pages_status` ในฐานข้อมูล
> ส่งค่าผิดแล้ว API ตอบ 400 พร้อมรายการค่าที่ถูกต้อง ซึ่ง `TaskTools.Run`
> ส่งต่อให้ AI อ่านเอง (สำเนาที่ต้อง sync ด้วยมือคือสำเนาที่จะหลุด sync)

## ข้อจำกัดที่ต้องรู้

**AI อ่านหรือเขียนเนื้อหาในหน้าไม่ได้** — แตะได้แค่ชื่อ สถานะ ไอคอน และโครงสร้าง

เนื้อหาของหน้าเป็น Yjs CRDT เก็บเป็น `bytea` ทึบ ๆ ที่เซิร์ฟเวอร์อ่านไม่ออกโดยเจตนา
(ดู PLAN.md "การตัดสินใจเชิงสถาปัตยกรรม ข้อ 1") ส่วน `POST /projection` ที่รับ plain
text เป็นทางเข้า search index เท่านั้น — **เขียนไปแล้วเบราว์เซอร์จะทับทิ้งใน 2 วินาที**
เพราะ client ผลิต projection ใหม่จาก Y.Doc ตัวจริงเสมอ

การเปิดทางให้อ่าน/เขียนเนื้อหาต้องเพิ่ม `GET/PUT /pages/{id}/content` ฝั่ง API โดยใช้
[YDotNet](https://www.nuget.org/packages/YDotNet) (binding ของ `yrs` ที่เขียนด้วย Rust)
เป็นงานที่วางแผนไว้แล้วแต่ยังไม่ทำ

> ⚠️ ขาเขียนมีขอบมีด: ถ้าสร้างโครงสร้างผิด schema ของ BlockNote แม้แต่นิดเดียว
> `createNodeFromYElement` ของ y-prosemirror จะ **ลบ element นั้นทิ้งแล้วกระจาย
> การลบไปทุก client** ไม่ใช่แค่ render พลาด — เป็นการทำข้อมูลหายจริง ต้องมี
> round-trip test ที่โหลดกลับใน BlockNote จริงก่อนปล่อย

ยังไม่มี tool สำหรับ: ย้าย/ลบ/กู้คืนหน้า, ค้นหา (ยังไม่มี `SearchController`),
จัดการสมาชิก, database views

## ตรวจว่าใช้ได้จริง

```bash
dotnet run --project api          # ต้องเปิดค้างไว้ก่อน
node scripts/verify-mcp.mjs       # 25 เคส
```

สคริปต์นี้สมัครบัญชีใช้แล้วทิ้งของตัวเอง ส่ง credential ให้ MCP ทาง env var จึงไม่แตะ
User Secrets ของคุณ แล้วพูด JSON-RPC กับ MCP server จริง ๆ ตั้งแต่ `initialize`,
`tools/list` ไปจนถึง `tools/call`

ที่มันตรวจแล้ว compiler ตรวจไม่ได้:

- **ไม่มีอะไรที่ไม่ใช่ JSON-RPC หลุดลง stdout** — stdio ใช้ stdout เป็นช่องโปรโตคอล
  `Console.WriteLine` หรือ log ที่หลุดมาแม้บรรทัดเดียวทำให้ client parse ไม่ได้ทั้ง
  session (`Program.cs` จึงบังคับ log ทุกอย่างไป stderr)
- **tool ถูกค้นเจอครบและมี inputSchema ถูกต้อง** — ลืม attribute แล้ว tool หายไป
  เงียบ ๆ โดย build ยังผ่าน
- **error กลับไปเป็นข้อความที่อ่านรู้เรื่อง** — MCP SDK กลืนข้อความของ exception ทิ้ง
  แล้วส่งกลับแค่ `"An error occurred invoking 'xxx'."` ทำให้ Claude ไม่รู้ว่าพลาดตรงไหน
  แล้วมักลองซ้ำแบบเดิมวนไป `TaskTools.Run` จึงดักไว้เองทุกตัว

## แก้ปัญหา

| อาการ | สาเหตุ |
|---|---|
| `/mcp` ขึ้น failed | ยังไม่ได้ build — รัน `pwsh scripts/setup-mcp.ps1` |
| `ต่อ API ไม่ได้ที่ …` | ยังไม่ได้เปิด API หรือ `Pm:ApiUrl` ผิด port (dev = 5081, container = 5080) |
| `ยังไม่ได้ตั้ง Pm:Email` | รัน `pwsh scripts/setup-mcp.ps1` |
| `มีหลาย workspace` | ตั้ง `Pm:Workspace` เป็น slug หรือ GUID |
| `API 500 … column p.status does not exist` | ยังไม่ได้ลง migration — `dotnet ef database update --project api` |
