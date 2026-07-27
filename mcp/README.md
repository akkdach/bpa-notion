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
| `find_pages` | ไม่ใส่อะไร = ภาพรวมโปรเจกต์ · `query` = ค้นหาไทยในชื่อ+เนื้อหา · `parent_id` = งานใต้หน้านั้น · `status` = กรองสถานะ · `in_trash` = ดูถังขยะ |
| `get_page` | รายละเอียดหน้าหนึ่ง + งานลูก + **เนื้อหาของหน้า** |
| `create_page` | ไม่ใส่ `parent_id` = โปรเจกต์ · ใส่ = งานใต้หน้านั้น · รับ `status` ตอนสร้าง |
| `update_page` | ชื่อ / สถานะ / `clear_status` / ไอคอน / **ย้ายหน้า** |
| `delete_page` | ย้ายไปถังขยะพร้อมลูกหลาน (กู้คืนได้) |
| `restore_page` | กู้คืนจากถังขยะ |

### ทำไมมีแค่ 6 ตัว

schema ของทุก tool อยู่ใน system prompt ของ **ทุก session** ในโฟลเดอร์นี้ตลอดไป
ไม่ว่า session นั้นจะเกี่ยวกับแอปนี้หรือไม่ และ tool ที่คล้ายกันหลายตัวทำให้โมเดล
เลือกผิดบ่อยขึ้น — โดยที่ทุกตัวคืน text ไทยล้วน ไม่มีสัญญาณให้กู้เมื่อเลือกผิด

จึงรวมด้วยพารามิเตอร์แทนการแตกเป็นหลายตัว: `find_pages` แทนสี่อย่าง (ลิสต์โปรเจกต์
ลิสต์งาน ค้นหา ดูถังขยะ), `create_page` แทน `create_project` + `create_task`
(ต่างกันแค่ `parent_id`), `update_page` แทน `update_task` + `complete_task` + ย้ายหน้า

> **ไม่มี tool ลบถาวร (purge) ให้ AI โดยเจตนา** — การลบที่ย้อนไม่ได้ไม่ใช่สิ่งที่ AI
> ต้องทำได้ เจ้าของทำเองจากหน้าถังขยะบนเว็บ เป็นการตัดสินใจเรื่องความปลอดภัย
> `verify-mcp.mjs` มีเคสล็อกไว้ว่าต้องไม่มี

> รายการสถานะที่อนุญาต **ไม่มีสำเนาใน `mcp/`** — แหล่งความจริงคือ
> `api/Domain/PageStatus.cs` กับ constraint `ck_pages_status` ในฐานข้อมูล
> ส่งค่าผิดแล้ว API ตอบ 400 พร้อมรายการค่าที่ถูกต้อง ซึ่ง `TaskTools.Run`
> ส่งต่อให้ AI อ่านเอง (สำเนาที่ต้อง sync ด้วยมือคือสำเนาที่จะหลุด sync)

## ข้อจำกัดที่ต้องรู้

**AI อ่านเนื้อหาหน้าได้แล้ว แต่ยังเขียนไม่ได้**

เนื้อหาของหน้าเป็น Yjs CRDT เก็บเป็น `bytea` ทึบ ๆ ที่เซิร์ฟเวอร์อ่านไม่ออกโดยเจตนา
(ดู PLAN.md "การตัดสินใจเชิงสถาปัตยกรรม ข้อ 1") ขาอ่านจึงไม่ได้อ่านเอกสารจริง —
มันอ่าน **projection** ที่เบราว์เซอร์แกะเป็น plain text แล้วส่งกลับมาให้ index ค้นหา

ผลที่ตามมาซึ่งต้องรู้:

- `get_page` คืน `freshness` มาด้วยเสมอ **`never` ไม่เท่ากับ "หน้าว่าง"** — มันแปลว่า
  ยังไม่เคยมีเบราว์เซอร์เปิดหน้านั้น ข้อความจึงยังไม่มี ไม่ใช่ว่าหน้าไม่มีเนื้อหา
- หน้าที่แก้ตอน offline → projection ถูกทิ้ง (client ไม่ retry) ข้อความจะล้า
- หน้าที่มีแต่ viewer/commenter เข้า → ล้าตลอดกาล (`POST /projection` ต้องมีสิทธิ์แก้)
- ข้อความถูกตัดที่ 100,000 ตัวอักษร

**ขาเขียน** ต้องเพิ่ม `PUT /pages/{id}/content` โดยใช้
[YDotNet](https://www.nuget.org/packages/YDotNet) (binding ของ `yrs` ที่เขียนด้วย Rust)
ยังไม่ทำ และมีขอบมีดสองชั้นไม่ใช่ชั้นเดียว:

| ความผิด | ผล |
|---|---|
| element เดียวผิด schema ของ BlockNote | `createNodeFromYElement` ของ y-prosemirror **ลบ element นั้นแล้วกระจายการลบไปทุก client** — ข้อมูลหายจริง |
| ระดับบนสุดไม่ใช่ `blockGroup` เดียวเป๊ะ | `tr.replace()` throw **นอก try/catch** → **editor ไม่ render เลยทุก client และไม่ self-heal** |

`append-only` ไม่ช่วยกรณีที่สอง เพราะหน้าที่ AI สร้างและยังไม่มีใครเปิดจะมี fragment
ว่างเปล่า — ต้องสร้าง `blockGroup` เอง ซึ่งคือ write ที่ทำ editor พังพอดี
ต้องมี round-trip test ที่โหลดผลลัพธ์ใน BlockNote จริงก่อนปล่อย

> ⚠️ `scripts/verify-ydoc.mjs` ทดสอบ `doc.getText('content')` ซึ่งเป็น **คนละ root type**
> กับที่แอปใช้จริง (`doc.getXmlFragment('blocknote')` — ดู `PageEditor.tsx`)
> pipeline Yjs ที่ "พิสูจน์แล้ว" จึงพิสูจน์แค่ `Y.Text` แบน ๆ ไม่ครอบคลุมรูปร่างจริง

ยังไม่มี tool สำหรับ: บันทึกความคืบหน้า/คอมเมนต์, จัดการสมาชิก, database views

## ตรวจว่าใช้ได้จริง

```bash
dotnet run --project api          # ต้องเปิดค้างไว้ก่อน
node scripts/verify-mcp.mjs       # 38 เคส
```

> ⚠️ **build ทับไม่ได้ตอน Claude Code เปิดอยู่** — มันถือ
> `ProjectManagementMcp.dll` เปิดไว้ตลอด session (`file is locked by .NET Host`)
> แปลว่าแก้โค้ดใน `mcp/` แล้วยืนยันไม่ได้เลยจนกว่าจะปิด Claude Code
>
> ทางออกตอนพัฒนา — build เป็นชื่ออื่นแล้วชี้ไปที่ตัวนั้น:
>
> ```bash
> dotnet build mcp -c Release -p:AssemblyName=ProjectManagementMcpVerify
> PM_MCP_DLL=mcp/bin/Release/net10.0/ProjectManagementMcpVerify.dll \
>   node scripts/verify-mcp.mjs
> ```
>
> ส่วนการใช้งานจริงยังต้อง `pwsh scripts/setup-mcp.ps1` แล้ว **เปิด Claude Code ใหม่**
> ไม่งั้นมันยังเสิร์ฟ tool ชุดเก่าจาก .dll เดิมแบบเงียบ ๆ

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
- **จำนวน tool ไม่บานปลาย** — มีเคสยืนยันว่ามี 6 ตัวเป๊ะและไม่มี `purge`
  ทุก tool ที่เพิ่มเข้ามาต้องจ่ายค่า context ในทุก session ตลอดไป การให้เทสล็อกตัวเลข
  ไว้ทำให้การเพิ่ม tool เป็นการตัดสินใจที่ต้องตั้งใจ ไม่ใช่สิ่งที่ค่อย ๆ เพิ่มไปเรื่อย ๆ
- **หน้าที่ AI สร้างต้องค้นเจอทันที** — ถ้า `page_searches` ไม่ถูก seed ตอนสร้างหน้า
  การค้นหาจะไม่เจอผลงานของ AI เองตลอดไป (เพราะแถวนั้นเกิดตอนเบราว์เซอร์ส่ง projection)

## แก้ปัญหา

| อาการ | สาเหตุ |
|---|---|
| `/mcp` ขึ้น failed | ยังไม่ได้ build — รัน `pwsh scripts/setup-mcp.ps1` |
| `ต่อ API ไม่ได้ที่ …` | ยังไม่ได้เปิด API หรือ `Pm:ApiUrl` ผิด port (dev = 5081, container = 5080) |
| `ยังไม่ได้ตั้ง Pm:Email` | รัน `pwsh scripts/setup-mcp.ps1` |
| `มีหลาย workspace` | ตั้ง `Pm:Workspace` เป็น slug หรือ GUID |
| `API 500 … column p.status does not exist` | ยังไม่ได้ลง migration — `dotnet ef database update --project api` |
