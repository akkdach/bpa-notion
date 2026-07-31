---
name: pm-tasks
description: อ่านก่อนเรียก tool ที่ขึ้นต้นด้วย mcp__projectmanagement__ ทุกครั้ง — บอกว่า MCP นี้ทำอะไรได้/ไม่ได้, ต้องเปิด API ที่ 5081 ก่อน, error มาเป็นข้อความปกติไม่ใช่ isError, และเนื้อหาในหน้าอ่าน/เขียนไม่ได้. ใช้เมื่อผู้ใช้ขอดู/สร้าง/แก้/ปิด โปรเจกต์ งาน หรือ task ในแอป ProjectManagement เช่น "มีโปรเจกต์อะไรบ้าง" "งานค้างอะไร" "สร้างงานใหม่" "ปิดงานนี้" "เปลี่ยนสถานะเป็น doing" "เพิ่มเนื้อหาในหน้านี้" — or in English: list projects, show my tasks, what's in progress, create/add a task, update task status, mark task done, close this task, todo / doing / done, project management workspace, page tree
---

# MCP `projectmanagement` — ทำอะไรได้ ทำอะไรไม่ได้

MCP server แบบ stdio ที่ครอบ REST API ของ `api/` **ไม่แตะฐานข้อมูลเอง** จึงได้ tenant
isolation + permission check ชุดเดียวกับเว็บ และเห็นได้เท่าที่บัญชีที่ล็อกอินไว้เห็น

โค้ดอยู่ที่ [mcp/TaskTools.cs](../../../mcp/TaskTools.cs) · เอกสารเต็ม [mcp/README.md](../../../mcp/README.md)

---

## ก่อนเรียก tool ตัวแรก

**API ต้องเปิดค้างอยู่** — MCP คุยกับมันผ่าน HTTP ที่ `http://localhost:5081`

```bash
dotnet run --project api
```

ถ้าไม่ได้เปิด ทุก tool จะคืน `ทำไม่ได้: ต่อ API ไม่ได้ที่ …` — อย่าลองซ้ำ ให้บอกผู้ใช้
ให้เปิด API ก่อน (dev = 5081, container = 5080 — ต่างกัน อย่าสลับ)

---

## โมเดลข้อมูล

ไม่มีตาราง task แยก — **ทุกอย่างคือหน้า (page)**

| แนวคิด | คือ |
|---|---|
| โปรเจกต์ | หน้าระดับบนสุด (`parent_id = null`) |
| งาน | หน้าลูกใต้โปรเจกต์ |
| สถานะ | คอลัมน์ `pages.status` — `todo` / `doing` / `done` |
| `status = null` | หน้าธรรมดา **ไม่ใช่งาน** (เอกสาร, โน้ต) |

ทุก id เป็น GUID — เอามาจาก `list_projects` / `list_tasks` เท่านั้น **ห้ามเดา ห้ามแต่ง**

---

## tool ที่มี (7 ตัว)

อ่าน:

| tool | args | ได้อะไร |
|---|---|---|
| `list_projects` | — | โปรเจกต์ทั้งหมด + จำนวนงานค้าง + id |
| `list_tasks` | `projectId?` `status?` `includeDone?` | งานใต้โปรเจกต์ · เว้น `projectId` = งานทั้ง workspace · **ซ่อน done เป็นค่าเริ่มต้น** |
| `get_task` | `taskId` | หน้าหนึ่ง + สถานะ + parent + งานลูก |

เขียน:

| tool | args | หมายเหตุ |
|---|---|---|
| `create_project` | `title` `icon?` | หน้าระดับบนสุด คืน id |
| `create_task` | `projectId` `title` `status?` `icon?` | ค่าเริ่มต้น `todo` |
| `update_task` | `taskId` `title?` `status?` `icon?` | ส่งเฉพาะที่จะเปลี่ยน · ไม่ส่งอะไรเลย = ไม่มีผล |
| `complete_task` | `taskId` | ทางลัดของ `update_task(status: "done")` |

ลำดับงานเรียงตาม `rank` (fractional index, เทียบแบบ byte order) — ที่ tool คืนมา
ตรงกับที่ผู้ใช้เห็นบนเว็บแล้ว **อย่าเรียงใหม่เอง**

---

## ⛔ ทำไม่ได้ — อย่าเสียเทิร์นลอง

**อ่านหรือเขียนเนื้อหาข้างในหน้าไม่ได้** แตะได้แค่ ชื่อ / สถานะ / ไอคอน / โครงสร้าง

เนื้อหาเป็น Yjs CRDT เก็บเป็น `bytea` ที่เซิร์ฟเวอร์อ่านไม่ออกโดยเจตนา ส่วน
`POST /projection` ที่รับ plain text เป็นทางเข้า search index เท่านั้น —
**เขียนไปแล้วเบราว์เซอร์จะทับทิ้งใน 2 วินาที** เพราะ client ผลิต projection ใหม่
จาก Y.Doc ตัวจริงเสมอ

ถ้าผู้ใช้ขอให้เขียนเนื้อหาในหน้า → บอกตรง ๆ ว่ายังทำไม่ได้ และมันเป็นงานที่วางแผน
ไว้แล้ว (`GET/PUT /pages/{id}/content` ด้วย YDotNet) ไม่ใช่ลองหาทางอ้อม

ยังไม่มี tool สำหรับ: **ย้าย / ลบ / กู้คืนหน้า · ค้นหา · จัดการสมาชิก · database views**

---

## ⚠️ error กลับมาเป็นข้อความปกติ ไม่ใช่ isError

`TaskTools.Run` ดักทุก exception แล้วคืนเป็น string ขึ้นต้นว่า `ทำไม่ได้: …`
เหตุผล: MCP SDK กลืนข้อความจริงทิ้งแล้วส่งกลับแค่ `"An error occurred invoking 'xxx'."`

**ต้องอ่านข้อความที่ได้จริง ๆ ทุกครั้ง** — ผลลัพธ์ที่ขึ้นต้นด้วย `ทำไม่ได้:` หรือ
`เกิดข้อผิดพลาดที่ไม่คาดคิด` คือ **ล้มเหลว** ห้ามรายงานว่าสำเร็จ และห้ามลองซ้ำแบบเดิม
— ให้แก้ค่าที่ส่งผิดก่อน

| ข้อความ | ทำอะไรต่อ |
|---|---|
| `สถานะต้องเป็น: todo / doing / done` | ส่ง status ผิด — ใช้ 3 ค่านี้เท่านั้น |
| `ต่อ API ไม่ได้ที่ …` | API ไม่ได้เปิด — บอกผู้ใช้ให้ `dotnet run --project api` |
| `ยังไม่ได้ตั้ง Pm:Token` | ยังไม่ setup — บอกผู้ใช้ให้สร้าง token ที่ ตั้งค่า → การเชื่อมต่อ AI แล้วรัน `pwsh scripts/setup-mcp.ps1` |
| `API 401` ทุกคำสั่ง | token ถูกเพิกถอนหรือหมดอายุ — ห้ามลองซ้ำ บอกผู้ใช้ให้ออกใบใหม่ |
| `token นี้ใช้ได้กับ workspace ที่ออกให้เท่านั้น` | ใช้ token ผิด workspace — ต้องออกใบใหม่ใน workspace ที่ต้องการ |
| `column p.status does not exist` | ยังไม่ลง migration — `dotnet ef database update --project api` |

---

## ลำดับที่ใช้ได้จริง

```
list_projects                    → ได้ id ของโปรเจกต์
  └─ list_tasks(projectId)       → ได้ id ของงาน
       └─ update_task / complete_task
```

- **ต้อง `list_projects` ก่อนเสมอ** ถ้ายังไม่มี id ในมือ
- สร้างงานต้องมี `projectId` — ไม่มีโปรเจกต์ก็ `create_project` ก่อน
- `create_task` ยิง 2 request ข้างใน (POST แล้ว PATCH status) — ถ้าพังกลางทาง
  อาจเหลือหน้าที่ยังไม่มีสถานะค้างไว้ ตรวจด้วย `get_task` ก่อนสร้างซ้ำ
- งานที่ `done` ไม่โผล่ใน `list_tasks` ถ้าไม่ส่ง `includeDone: true` — ผู้ใช้ถามว่า
  "งานหายไปไหน" มักเป็นเพราะข้อนี้ ไม่ใช่ข้อมูลหาย

## ตรวจว่า MCP ยังใช้ได้

```bash
dotnet run --project api      # ต้องเปิดค้าง
node scripts/verify-mcp.mjs   # 25 เคส คุย JSON-RPC กับ server จริง
```
