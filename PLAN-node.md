# แผนย้าย `api/` จาก ASP.NET Core → Node.js

**ตัดสินใจแล้ว:** Big bang (ตัดทีเดียว) · NestJS · Drizzle · Postgres RLS

> **โปรเจกต์ยังไม่ได้ใช้งานจริง — ไม่มีผู้ใช้ ไม่มีข้อมูลที่ต้องรักษา**
>
> ทำให้ความเสี่ยง 3 ใน 4 ข้อของแผนเดิมหายไปทั้งหมด: ไม่ต้องอ่าน BCrypt hash เดิม,
> ไม่ต้องรองรับ JWT ที่ออกไปแล้ว, ไม่ต้อง introspect schema เดิมเป็น baseline
>
> แต่ **ไม่ได้แปลว่าทิ้งดีไซน์** — 23 migration คือความคิดที่ตกผลึกแล้ว
> (check constraint, PGroonga tokenizer, `COLLATE "C"`) ยกมาครบ แค่ไม่ต้องแบกประวัติ

เอกสารนี้คือแผนของการย้าย — สถาปัตยกรรมและ schema ตัวจริงยังอยู่ที่ [PLAN.md](PLAN.md)
อ่านเล่มนั้นก่อนถ้ายังไม่รู้ว่าระบบทำอะไร

---

## ขอบเขต

ย้ายทั้งหมด — 11,000 บรรทัดที่เขียนเอง (ไม่นับ 8,320 บรรทัด `*.Designer.cs` ที่ EF generate)

| ชั้น | บรรทัด | หมายเหตุ |
|---|---:|---|
| Services | 4,027 | หนักสุด — มี Yjs/BlockNote 1,414 อยู่ในนี้ |
| Repositories | 1,938 | |
| Data (ไม่รวม migration) | 1,082 | DbContext, TenantContext, IdentityQueries |
| Migrations up/down | 874 | + `Sql/*.sql` ที่ฝังเป็น embedded resource |
| Controllers | 665 | 9 controller · 43 endpoint |
| Configurations | 604 | |
| Models · DTOs · Domain · Validators · Mapping | 1,293 | |
| Filters · Middlewares · Helpers | 556 | |

**ไม่ย้าย:** `web/` (ไม่แตะ), `mcp/` (คุยผ่าน REST อยู่แล้ว — ย้ายทีหลังได้ ไม่เร่ง)

---

## สิ่งที่รู้แล้วว่าจริง (สำรวจโค้ดแล้ว ไม่ใช่เดา)

**1. `web/` ไม่ได้ใช้ SignalR จริง**

`web/src/realtime/` ว่างเปล่า ไม่มีไฟล์ไหนใน `web/src` import `@microsoft/signalr`
และ `MapHub<DocHub>` ยัง comment ไว้ที่ [RealtimeConfiguration.cs:45](api/Configurations/RealtimeConfiguration.cs#L45)

→ **realtime ย้ายไป Node ได้โดยไม่ต้องแก้ฝั่ง web เลย** เหลือแค่แก้ proxy `/hubs`
ใน `vite.config.ts` + `nginx.conf` และถอด `@microsoft/signalr*` ออกจาก `package.json`

**2. งาน Yjs/BlockNote เขียนไปแล้ว 1,414 บรรทัด และเป็นส่วนที่ได้กำไรมากที่สุดจากการย้าย**

`YDotNet 0.6.0` + `YDotNet.Native` อยู่ใน csproj แล้ว — เป็น binding ของ `yrs` (Rust)
ฝั่ง Node ใช้ `yjs` ตัวจริงที่ `web/` มีอยู่แล้ว → server รันโค้ดเส้นเดียวกับ client

**3. `mcp/README.md` ล้าสมัย** — เขียนว่าไม่มี `SearchController` และอ่านเนื้อหาหน้าไม่ได้
แต่ตอนนี้มีทั้ง `SearchController` และ `GET /pages/{id}/content` แล้ว ต้องแก้ตอนจบงาน

---

## map package → Node

| C# | Node | ความเสี่ยง |
|---|---|---|
| Npgsql + EF Core 10 + EFCore.NamingConventions | **Drizzle** + `pg` | 🔴 ไม่มี global query filter → ใช้ RLS แทน |
| `YDotNet` + `YDotNet.Native` | **`yjs`** | 🟢 ได้กำไร — ตัวจริง ไม่ใช่ binding |
| `BlockNoteWriter.cs` 339 บรรทัด | **`@blocknote/core`** + `y-prosemirror` | 🟢 หดลงมาก |
| `Markdig` + `MarkdownToBlockNote.cs` 449 บรรทัด | `@blocknote/core` แปลง markdown ได้ในตัว | 🟢 หดลงมาก |
| `BCrypt.Net-Next` | `@node-rs/bcrypt` | 🟡 **ต้อง verify hash เดิมได้** ผู้ใช้เดิมล็อกอินต้องไม่พัง |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | `@nestjs/jwt` + `jose` | 🟡 claim/issuer/audience ต้องตรงเป๊ะ token เดิมถึงไม่ตาย |
| `FluentValidation` | `zod` + `ZodValidationPipe` | 🟢 |
| `Swashbuckle` | `@nestjs/swagger` | 🟢 |
| `SignalR` + MessagePack | `y-websocket` (ws) | 🟢 ยังไม่ได้ใช้ → เลือกใหม่ได้อิสระ |

---

## เรื่องที่ยากจริง — เหลือข้อเดียว

| # | เดิม | ตอนนี้ |
|---|---|---|
| 🟡 2 | BCrypt hash เดิมต้องใช้ต่อได้ | **หมดไป** — เลือก `argon2` ได้เลย (OWASP แนะนำแทน bcrypt) |
| 🟡 3 | JWT ที่ออกไปแล้วต้องไม่ตาย | **หมดไป** — ออกแบบ claim ใหม่ได้อิสระ |
| 🟡 4 | ห้าม generate schema ใหม่ | **หมดไป** — ยุบ 23 migration เหลือ initial เดียว |
| 🔴 1 | RLS + connection pool | **ยังอยู่ — และเป็นข้อเดียวที่เหลือ** |

### กำไรที่ได้จากการเริ่มใหม่: SQL objects ยุบ 7 ไฟล์เหลือ 1

`Data/Migrations/Sql/001…007` มีปัญหาที่ [001 เตือนไว้เอง](api/Data/Migrations/Sql/001_check_constraints.sql):
migration ที่ apply แล้วห้ามแก้ย้อนหลัง ของใหม่ต้องไปอยู่ไฟล์เลขสูงกว่า **ผลคือต้อง
ไล่อ่านทั้ง 7 ไฟล์ถึงจะรู้ว่าฐานเป็นยังไงตอนนี้** เช่น `ck_page_acls_subject_type`
ถูกสร้างใน 001 แล้วถูก DROP+ADD ใหม่ใน 004

เริ่มใหม่ = เขียนไฟล์เดียวที่แต่ละ constraint ปรากฏครั้งเดียวในรูปสุดท้าย

สถานะสุดท้ายที่ยกมา (ไล่ครบ 001–007 แล้ว):

| constraint | ค่าสุดท้าย | มาจาก |
|---|---|---|
| `ck_workspace_members_role` | `owner/admin/member/guest` | 001 |
| `ck_pages_kind` | `page/database/db_row` | 001 |
| `ck_pages_db_row_has_database` | `(kind='db_row') = (database_id IS NOT NULL)` | 001 |
| `ck_pages_depth_matches_ancestors` | `depth = cardinality(ancestor_ids)` | 001 |
| `ck_pages_no_self_ancestor` | `NOT (id = ANY(ancestor_ids))` | 001 |
| `ck_page_acls_role` | `full/editor/commenter/viewer` | 001 |
| `ck_page_acls_subject_id` | uuid ว่าง ⇔ subject_type='workspace' | 001 |
| `ck_page_doc_snapshots_byte_size` | `byte_size > 0 AND octet_length(snapshot) = byte_size` | 001 |
| `ck_page_doc_updates_not_empty` | `octet_length(update_data) > 0` | 001 |
| `ck_workspaces_slug_format` | `^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$` | 001 |
| `ck_page_links_no_self` | `source_page_id <> target_page_id` | 004 |
| `ck_page_acls_subject_type` | **`user/workspace`** (ไม่มี `group`) | 001 → แก้ที่ 004 |
| `ck_pages_status` | `NULL OR todo/doing/done` | 005 |
| `ck_users_kind` | `human/agent` | 006 |
| FK `activity_logs → pages` | `ON DELETE SET NULL (page_id)` | 007 |

> ⚠️ FK ข้อสุดท้ายสำคัญกว่าที่หน้าตาบอก — `SET NULL` แบบไม่ระบุคอลัมน์จะ null
> `workspace_id` ที่เป็น NOT NULL ด้วย ทำให้ **purge หน้าที่มีประวัติไม่ได้เลย**
> ต้องใช้ column list ของ PostgreSQL 15+ ซึ่ง Drizzle ก็เขียนไม่ได้เหมือน EF
> → ไปอยู่ใน SQL ไฟล์เดียวกับ RLS

---

## เรื่องที่ยากจริง 4 ข้อ

### 1. 🔴 global query filter → RLS

[AppDbContext.cs](api/Data/AppDbContext.cs) คุม **9 entity** ด้วย
`.HasQueryFilter(TenantFilter, x => x.WorkspaceId == CurrentWorkspaceId)`
และ EF 10 แยก named filter ให้ปิด soft-delete โดยไม่ปิด tenant ได้

Drizzle ไม่มีอะไรแบบนี้เลย → ย้ายการบังคับลงไปที่ Postgres:

```sql
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pages
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
```

ทุก request ต้องเปิด transaction แล้ว `SET LOCAL app.workspace_id = $1` ก่อนแตะข้อมูล

> ⚠️ กับดักใหญ่: **connection pool** ถ้า `SET` แบบไม่ใช่ `LOCAL` ค่าจะติดค้างไปกับ
> connection แล้ว request ถัดไปที่หยิบ connection เดิมได้ tenant ผิด — เป็น tenant
> leak ที่ test ปกติจับไม่เจอเพราะต้อง reuse connection ถึงจะโผล่ ต้อง `SET LOCAL`
> ใน transaction เท่านั้น และต้องมี test ที่จงใจใช้ connection ซ้ำ

> ⚠️ RLS ไม่มีผลกับ table owner — ต้องต่อด้วย role ที่ไม่ใช่ owner หรือ
> `FORCE ROW LEVEL SECURITY` ไม่งั้น policy จะเงียบสนิทและ**ดูเหมือนผ่านหมด**
> (อาการเดียวกับที่ `eslint-plugin-boundaries` เคยเป็นตอนไม่มี resolver)

ส่วน soft-delete ไม่เอาเข้า RLS — เป็นเงื่อนไขปกติใน repository เพราะหน้า trash
ต้องเห็นของที่ลบแล้ว

### 2. 🟢 สิ่งที่ต้องยกมาให้ครบ แม้จะเริ่มใหม่

ไม่ใช่ความเสี่ยง แต่เป็นของที่ลืมแล้วเจ็บทีหลัง — Drizzle เขียนเองไม่ได้ทั้งหมด:

- **`COLLATE "C"` บน `pages.rank`** — fractional index ต้องเทียบแบบ byte order
  ถ้าใช้ collation ของเครื่อง ลำดับหน้าที่ผู้ใช้เห็นจะไม่ตรงกับที่ query คืนมา
- **PGroonga `WITH (tokenizer = 'TokenNgram(...)')`** — ไม่ใช่ของเสริม
  ค่า default ตัดคำด้วยช่องว่าง ภาษาไทยไม่มีช่องว่าง → ทั้งประโยคเป็น token เดียว
  ([003 มีผลทดสอบจริงแนบไว้](api/Data/Migrations/Sql/003_pgroonga_indexes.sql))
- **partial index 7 ตัว + GIN บน `uuid[]` และ `jsonb_path_ops`** — `ancestor_ids @> ARRAY[$id]`
  คือสิ่งที่ทำให้ย้าย subtree 500 หน้าเป็น UPDATE เดียว
- **composite FK `(workspace_id, page_id) → pages (workspace_id, id)`** — ทำให้อ้าง
  ข้าม workspace เป็นไปไม่ได้ที่ระดับฐาน ไม่ใช่แค่ระดับโค้ด
- **`citext` บน `users.email`** — unique ไม่สนตัวพิมพ์โดยไม่ต้องมี `lower()` index

### 3. 🟢 ห้ามใส่ CHECK บน `activity_logs.action` — โดยเจตนา

[ActivityAction](api/Domain/ActivityAction.cs) เป็น `const string` ไม่ใช่ enum เพราะ log
คือข้อมูลประวัติศาสตร์ แถวที่เขียนไปแล้วต้องอ่านได้ตลอดไปแม้โค้ดใหม่เลิกผลิต action นั้น
constraint จะทำให้ลบ action เก่าออกจากโค้ดไม่ได้เลย — เป็นข้อยกเว้นเดียวจาก enum อื่นทั้งระบบ

---

## ลำดับงาน

```
1  scaffold      NestJS + Drizzle + schema.ts + SQL objects ไฟล์เดียว + compose
2  RLS           policy 9 ตาราง · SET LOCAL ใน transaction · test ที่ reuse connection
                 ← ความเสี่ยงเดียวที่เหลือ พิสูจน์ให้จบก่อนเขียน endpoint แรก
3  auth          argon2 · JWT · refresh · api token
4  pages         tree · fractional index · move/trash/restore/purge · ACL
5  documents     Yjs + BlockNote (จุดที่โค้ดหดมากที่สุด)
6  ที่เหลือ       workspaces · members · search (PGroonga) · activity · notes · health
7  gates         แปลง check-architecture.mjs 7 ข้อ → lint rule ฝั่ง Node
8  test + ตัด    port test · smoke test · nginx/compose/IIS · ลบ api/
```

**ข้อ 2 คือประตูที่ต้องผ่านก่อน** — RLS เป็นความเสี่ยงเดียวที่เหลือ และมันพังแบบเงียบ
ถ้า policy ไม่ทำงานจะ *ดูเหมือนผ่านหมด* ต้องมี test ที่พิสูจน์ว่ามันบล็อกจริง
ก่อนจะเอาไปวางใจใน 43 endpoint

## เส้นตาย/จุดถอย

`api/` เดิมยังอยู่ใน git ตลอด — ลบทิ้งเป็นขั้นตอนสุดท้ายของข้อ 8 เท่านั้น
ก่อนหน้านั้น rollback = สลับ nginx กลับไปที่ container เดิม

## สิ่งที่ต้องแก้ตอนจบ ไม่ใช่ระหว่างทาง

- [ ] `mcp/README.md` — ข้อมูล `SearchController` / content endpoint ล้าสมัย
- [ ] `README.md` — ตาราง stack, โครงสร้าง, architecture gates
- [ ] `.claude/skills/pm-tasks/SKILL.md` — พอร์ต 5081 และข้อจำกัดที่เปลี่ยนไป
- [ ] `scripts/publish-iis.ps1` — ตอนนี้ publish .NET self-contained อยู่
- [ ] ถอด `@microsoft/signalr*` ออกจาก `web/package.json`
