# ProjectManagement

Self-hosted collaborative workspace — nested pages, block editor, realtime collaboration,
and Notion-style databases. Multi-tenant, on-prem.

แผนงานฉบับเต็มอยู่ใน **[PLAN.md](PLAN.md)** — สถาปัตยกรรม, schema, phase, ความเสี่ยง

| | |
|---|---|
| **Backend** | ASP.NET Core `net10.0` · EF Core 10 + Npgsql · SignalR (Yjs relay) · JWT เขียนเอง |
| **Frontend** | React 19 · Vite 7 · TypeScript · Tailwind v4 · shadcn/ui · Framer Motion (`motion`) |
| **Editor** | BlockNote `0.52.1` (Tiptap/ProseMirror ข้างใน) + Yjs CRDT |
| **Database** | PostgreSQL 18 + **PGroonga** (full-text search ภาษาไทย) |
| **Deploy** | Docker Compose → on-prem |

---

## เริ่มต้น

```bash
cp .env.example .env
```

แก้ `.env` อย่างน้อย 2 ค่า:

```bash
POSTGRES_PASSWORD=<ตั้งใหม่>
JWT_SECRET=<openssl rand -base64 48>     # ต้อง >= 32 bytes ไม่งั้น API ไม่ start
```

```bash
docker compose up -d --build --wait
```

| URL | คือ |
|---|---|
| http://localhost | เว็บ (nginx เสิร์ฟ SPA + proxy `/api` และ `/hubs`) |
| http://localhost/api/v1/health | health check ผ่าน nginx |
| http://localhost:5080 | API ตรง ๆ (Swagger UI อยู่ที่ root ตอน `ASPNETCORE_ENVIRONMENT=Development`) |
| `localhost:5440` | PostgreSQL |

> **ทำไม 5440 ไม่ใช่ 5432** — เครื่อง dev มักมี PostgreSQL ของตัวเองอยู่บน 5432 แล้ว
> ถ้าใช้ port ชนกัน อย่างดีคือ bind ไม่ติด อย่างแย่คือ `dotnet ef database update`
> ไปลง migration ผิดฐานโดยไม่มีใครรู้ ตั้งค่าได้ที่ `POSTGRES_HOST_PORT` ใน `.env`
> (ไม่ใช้ 5433 ด้วย เพราะเป็นเลขที่ compose project อื่นเลือกกันบ่อย)

### พัฒนาแบบไม่ผ่าน Docker

ตั้งค่าความลับครั้งเดียวก่อน — อ่านจาก `.env` แล้วเขียนลง .NET Secret Manager:

```powershell
pwsh scripts/setup-secrets.ps1        # Windows
bash scripts/setup-secrets.sh         # macOS / Linux / git-bash
```

จากนั้นรันได้เลย ไม่ต้อง export env var ใด ๆ:

```bash
docker compose up -d postgres     # เอาแค่ฐานข้อมูล

dotnet run --project api          # → http://localhost:5081  (Swagger ที่ /)
cd web && npm install && npm run dev   # → http://localhost:5173
```

`vite.config.ts` proxy `/api` และ `/hubs` ไป `localhost:5081` ให้แล้ว (รวม `ws: true`
สำหรับ SignalR) ตอน dev จึงเห็น origin เดียวเหมือน production → ไม่เจอ CORS ต่างกัน

> **5081 ไม่ใช่ 5080** — 5080 คือ container `pm-api` ที่ compose รันอยู่ ถ้า `dotnet run`
> ไปฟังทับ จะได้อาการที่ debug ยากมาก: โค้ดใหม่ที่แก้แล้วไม่มีผล เพราะเบราว์เซอร์คุยกับ
> container รุ่นเก่าอยู่ ทั้ง `launchSettings.json` และ vite proxy จึงตั้งเป็น 5081 ตรงกัน

---

## Configuration — ค่าไหนมาจากไหน

connection string ประกอบจากหลายชั้น ตามลำดับของ .NET configuration (ตัวหลังทับตัวหน้า):

| ชั้น | ไฟล์ / ที่มา | มีอะไร | ขึ้น git |
|---|---|---|---|
| 1 | `api/appsettings.json` | ประกาศ key ทั้งหมดเป็นค่าว่าง | ✅ |
| 2 | `api/appsettings.Development.json` | `Host=localhost;Port=5440;Database=…` **ไม่มี password** | ✅ |
| 3 | User Secrets (Development เท่านั้น) | `Postgres:Password`, `Jwt:Key` | ❌ |
| 4 | environment variable | `ConnectionStrings__DefaultConnection` เต็มเส้น (Docker) | ❌ (`.env`) |

`AddPersistence` เติม `Postgres:Password` ให้ connection string ที่ยังไม่มี password
— **แต่ถ้า connection string มี password มาแล้วจะไม่แตะ** เพื่อให้ env var ของ Docker
ชนะเสมอ เครื่องเดียวกันจึงรันทั้ง `dotnet run` และ `docker compose up` ได้โดยไม่ปนกัน

เหตุผลที่แยก password ออกจาก connection string: `appsettings.Development.json` ขึ้น git
จึงใส่ password ไม่ได้ ส่วน host/port/database **ไม่ใช่ความลับ** — มันคือ topology ของ
dev environment ที่ควรอ่านเจอในโค้ด ไม่ใช่ซ่อนอยู่ในเครื่องของใครคนหนึ่ง

```powershell
dotnet user-secrets list --project api      # ดูค่าที่ตั้งไว้
pwsh scripts/setup-secrets.ps1              # ตั้งใหม่จาก .env (รันซ้ำได้ ทับค่าเดิม)
```

### ชี้ไปที่ PostgreSQL ที่ไม่ใช่ Docker

แก้ host/port/database ใน `api/appsettings.Development.json` แล้วเก็บ password ไว้ที่ user secrets:

```powershell
dotnet user-secrets set "Postgres:Password" "<รหัสผ่าน>" --project api
```

เซิร์ฟเวอร์ปลายทางต้องมี **PGroonga** ติดตั้งอยู่ก่อน — เป็น binary ฝั่ง server สั่ง
`CREATE EXTENSION` เฉย ๆ ไม่พอ ตรวจได้ด้วย
`SELECT * FROM pg_available_extensions WHERE name = 'pgroonga'` ถ้าไม่มี migration
`AddSqlObjects` จะพังกลางคันตอนสร้าง index

```bash
dotnet run scripts/run-sql.cs db/init/001_extensions.sql   # สร้าง 3 extension
dotnet ef database update --project api                    # ลง schema
dotnet run scripts/run-sql.cs db/probe/thai-search-probe.sql   # ต้อง PASS ครบ 10
```

> `db/init/*.sql` ถูกรันอัตโนมัติเฉพาะตอน Docker สร้าง volume ใหม่เท่านั้น ปลายทาง
> อื่นไม่มีอะไรรันให้ — `scripts/run-sql.cs` มีไว้เพื่อการนี้ และมันอ่าน connection
> string ผ่าน configuration ชุดเดียวกับ api จึงชี้ฐานเดียวกันเสมอ

> เปลี่ยน `POSTGRES_PASSWORD` หรือ `JWT_SECRET` ใน `.env` แล้วต้องรัน `setup-secrets`
> ซ้ำ — สอง store นี้ไม่ได้ sync กันเอง

---

## โครงสร้าง

```
.
├─ PLAN.md                     ← แผนงานฉบับเต็ม อ่านก่อนเริ่มงานใหม่
├─ docker-compose.yml
├─ db/init/001_extensions.sql  ← pgroonga, pgcrypto, citext (รันครั้งเดียวตอน volume ว่าง)
├─ scripts/check-architecture.mjs
├─ api/                        ← ASP.NET Core — namespace ProjectManagementAPI
│   ├─ Program.cs              ← wiring เท่านั้น
│   ├─ Configurations/         ← ทุก services.Add… อยู่ที่นี่
│   ├─ Controllers/            ← thin — ห้ามแตะ AppDbContext
│   ├─ Realtime/               ← DocHub (Phase 2)
│   ├─ Services/               ← business logic (+ Abstractions/, PropertyTypes/, Formula/)
│   ├─ Repositories/           ← ที่เดียวที่ AppDbContext ปรากฏ
│   ├─ Data/                   ← AppDbContext, TenantContext, Migrations/
│   ├─ Models/ Domain/ DTOs/ Mapping/ Validators/ Filters/ Middlewares/ Helpers/
├─ web/                        ← Vite + React 19
│   └─ src/
│       ├─ lib/                ← apiClient, queryClient, cn()
│       ├─ components/{ui,common,layout}/
│       ├─ features/<domain>/{service,hooks,components}/ + index.ts
│       ├─ page/               ← ประกอบ route เท่านั้น
│       ├─ realtime/           ← SignalRProvider (Phase 2)
│       └─ app/                ← App.tsx, routes.tsx
├─ mcp/                        ← MCP server ให้ Claude Code สั่งงานแอปได้ (ดู mcp/README.md)
└─ .mcp.json                   ← Claude Code อ่านไฟล์นี้เพื่อรู้จัก MCP server ข้างบน
```

> **เชื่อมต่อ AI เข้ากับระบบ** — ทำตาม [`docs/connect-ai.md`](docs/connect-ai.md)
> (คู่มือสำหรับผู้ใช้/ลูกค้า) ส่วนรายละเอียดเชิงเทคนิคอยู่ใน [`mcp/README.md`](mcp/README.md)

> `mcp/` คุยกับแอปผ่าน REST API เหมือน client ทั่วไป **ไม่แตะฐานข้อมูลเอง** จึงได้
> tenant isolation และ permission check ชุดเดียวกับที่เว็บได้ ไม่ต้องเขียนซ้ำ

---

## Architecture gates

กฎ layer ที่ไม่มีเครื่องบังคับคือของประดับ กฎในโปรเจกต์นี้บังคับด้วย CI ทุกข้อ
และ **ทุก gate ถูกทดสอบแล้วว่าแดงจริง** ก่อนถูก commit

```bash
node scripts/check-architecture.mjs    # ฝั่ง api  (7 gates)
cd web && npm run lint                 # ฝั่ง web  (layer boundaries + axios)
```

สคริปต์ใน `scripts/` ที่ยิงของจริงรันใน CI job ชื่อ `verify` (ต้องมี API ขึ้นก่อน):

```bash
dotnet run --project api                        # ต้องเปิดค้างไว้
node scripts/smoke-test.mjs                     # REST ตั้งแต่ register ถึงแก้เนื้อหา
node scripts/verify-ydoc.mjs                    # Y.Doc → bytea → bootstrap
node scripts/verify-repair.mjs                  # ทำ denormalise เพี้ยนแล้วซ่อม
node scripts/verify-mcp.mjs                     # JSON-RPC กับ MCP server จริง
cd web && npx playwright test                   # เบราว์เซอร์จริง
```

> ก่อนหน้านี้ **ไม่มี job ไหนใน CI รันสคริปต์พวกนี้หรือ playwright เลย**
> `smoke-test.mjs` มี `check()` 116 ข้อที่ไม่มีใครบังคับ — เขียนไว้แล้วพังได้เงียบ ๆ

### ฝั่ง API

| Gate | เหตุผล |
|---|---|
| Controllers / Hubs ไม่แตะ `AppDbContext` · `DbSet<>` | query ที่เขียนตรงใน controller คือ query ที่ข้าม tenant filter และ permission check |
| Services ไม่แตะ `AppDbContext` | business logic คุยผ่าน `IXxxRepository` |
| ไม่มี `IgnoreQueryFilters()` แบบไม่ระบุชื่อ filter | ปิด tenant filter พร้อม soft-delete — เป็นวิธีที่ tenant leak หลุด production |
| ไม่มี AutoMapper | map `WorkspaceId` / `PasswordHash` ออกไปเงียบ ๆ พังตอน runtime ไม่ใช่ compile |
| ไม่มี `AllowAnyOrigin()` | ใช้ร่วมกับ `AllowCredentials()` ที่ SignalR ต้องมี → throw ตอน runtime |
| ไม่มี connection string hardcode | secret มาจาก env เท่านั้น |

ข้อยกเว้นเดียว: `Data/IdentityQueries.cs` ข้าม tenant filter ได้ (login / my-workspaces)

### ฝั่ง Web

ทิศทาง dependency มีทางเดียว บังคับด้วย `eslint-plugin-boundaries`:

```
app → page → features → components/common → components/ui → lib
```

- ห้ามย้อนทิศ · ห้ามข้าม feature ตรง ๆ (ต้องผ่าน `index.ts` ของ feature นั้น)
- `components/ui/*` ต้อง copy ไปโปรเจกต์อื่นได้ทั้งก้อน → import ได้แค่ `lib`
- `axios` อยู่ได้แค่ใน `features/*/service/` และ `lib/apiClient.ts`
- component รับ props / ส่ง callback — **ไม่ fetch เอง** data อยู่ใน `hooks/`

> ⚠️ `boundaries` ต้องมี `import/resolver: { typescript: … }` เพื่อ resolve alias `@/`
> ถ้าไม่มี dependency จะเป็น `isUnknown` แล้ว policy **ผ่านหมดเงียบ ๆ** — gate จะดู
> เหมือนทำงานแต่ไม่จับอะไรเลย

---

## คำสั่งที่ใช้บ่อย

```bash
# api
cd api
dotnet build                                   # TreatWarningsAsErrors เปิดอยู่
dotnet ef migrations add <Name> -o Data/Migrations
dotnet ef database update

# web
cd web
npm run dev
npm run lint          # รวม layer gate
npm run typecheck
npx vite build
npx shadcn@4 add button input dialog           # ลง primitive ใน components/ui/

# ฐานข้อมูล
docker compose exec postgres psql -U postgres -d projectmanagement
docker compose exec postgres psql -U postgres -d projectmanagement \
  -c "SELECT pgroonga_tokenize('ผมชอบกินข้าวผัดกระเพราไก่')"
```

---

## Convention

- **identifier เป็นอังกฤษ · คอมเมนต์อธิบายเป็นไทย** และใช้ banner `═══` / `───`
- ฝั่ง web ใช้ **named export** เท่านั้น (default export ทำให้ rename-refactor พลาด)
- service ทุกตัวมี interface — จำเป็นสำหรับ tenant-isolation test และ unit test
- **`Result<T>` สำหรับ failure ที่คาดไว้** exception ไว้ใช้กับบั๊กจริง ๆ
  (`DocHub.PushUpdate` ทำงานทุก keystroke — throw/catch ใน hot path เป็นปัญหา performance จริง)

---

## ⚠️ PGroonga: ต้องระบุ tokenizer ทุก index

ทดสอบจริงใน Phase 0 แล้ว — **ค่า default ทำให้ค้นภาษาไทยพังแบบเงียบ ๆ**

```sql
-- ❌ ผิด: ตัดคำด้วยช่องว่างแล้ว prefix match
--    ภาษาไทยไม่มีช่องว่างระหว่างคำ → ทั้งประโยคกลายเป็น token เดียว
--    ค้น "ข้าวผัด" ใน "สูตรข้าวผัดกระเพราไก่" → ได้ 0 แถว
CREATE INDEX … USING pgroonga (search_text);

-- ✅ ถูก
CREATE INDEX … USING pgroonga (search_text)
  WITH (tokenizer = 'TokenNgram("n", 2, "unify_alphabet", false)');
```

กับดักคือ **คำที่อยู่ต้นประโยคจะค้นเจอ** (`ยอดขาย` เจอเพราะเป็น prefix ของ
`ยอดขายเครื่องดื่ม…`) ถ้า test corpus ใช้คำต้นประโยคหมด จะผ่านเทสแล้วขึ้น production พร้อมบั๊ก

เปลี่ยน tokenizer ทีหลังต้อง `REINDEX` ทั้งตาราง → ต้องตั้งให้ถูกตั้งแต่ migration แรก
ตารางผลทดสอบเต็มอยู่ใน [PLAN.md](PLAN.md) หัวข้อ Phase 6

---

## สถานะ

**Phase 0 เสร็จและ verify ครบ**

| | |
|---|---|
| `dotnet build` Release | ✅ 0 warning (เปิด `TreatWarningsAsErrors`) |
| `tsc -b` / `eslint` / `vite build` | ✅ |
| Architecture gates 13 ตัว | ✅ ทุกตัวพิสูจน์แล้วว่าแดงจริงเมื่อละเมิด |
| `docker compose up --wait` | ✅ ทุก container healthy |
| pgroonga 4.0.6 · pgcrypto 1.4 · citext 1.8 | ✅ |
| PostgreSQL 18.3 + ICU `datlocale=th-TH` | ✅ เรียงคำไทยถูกตามพจนานุกรม |
| PGroonga ค้นไทยด้วย bigram + score + snippet | ✅ ไม่ over-match, ใช้ Index Scan |
| health 200 ทั้ง `:5080` และผ่าน nginx `:80/api` | ✅ |
| SPA fallback (`/w/acme/page/abc`) | ✅ 200 |
| nginx route `/hubs` → api | ✅ 404 จาก API ไม่ใช่ 502 จาก nginx |

**ถัดไป: Phase 1** — walking skeleton: register → login → สร้าง workspace → nested page
ใน sidebar → พิมพ์ใน BlockNote → refresh แล้วเนื้อหายังอยู่

ดู phase ทั้งหมดและ risk ที่รออยู่ใน [PLAN.md](PLAN.md)

### หนี้ที่รู้ตัวแล้ว

- bundle 525 kB (gzip 171 kB) ตั้งแต่ Phase 0 — ต้องทำ `manualChunks` แยก
  BlockNote / Yjs / motion ออกใน Phase 1 ก่อนที่มันจะโตกว่านี้
- `MaximumReceiveMessageSize` ตั้งไว้ 4 MB แล้วแต่ยังไม่มี hub ให้ทดสอบ — ต้องยืนยัน
  ตอน Phase 2 ว่า client ที่ offline กลับมา push full state ได้จริง
- ยังไม่มี test project — Phase 1 ต้องเริ่มด้วย `tests/ProjectManagementAPI.Tests/`
  พร้อม `[Theory]` route table สำหรับ tenant isolation (CI workflow เตรียม step ไว้แล้ว)
- PGroonga ยังทดสอบแค่ corpus 5 แถว — Phase 6 ต้องวัด recall และขนาด index ที่ ~2,000 หน้า
