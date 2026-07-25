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
| `localhost:5433` | PostgreSQL |

> **ทำไม 5433 ไม่ใช่ 5432** — เครื่อง dev มักมี PostgreSQL ของตัวเองอยู่บน 5432 แล้ว
> ถ้าใช้ port ชนกัน อย่างดีคือ bind ไม่ติด อย่างแย่คือ `dotnet ef database update`
> ไปลง migration ผิดฐานโดยไม่มีใครรู้ ตั้งค่าได้ที่ `POSTGRES_HOST_PORT` ใน `.env`

### พัฒนาแบบไม่ผ่าน Docker

```bash
docker compose up -d postgres     # เอาแค่ฐานข้อมูล

cd api && dotnet run              # → http://localhost:5080  (Swagger ที่ /)
cd web && npm install && npm run dev   # → http://localhost:5173
```

`vite.config.ts` proxy `/api` และ `/hubs` ไป `localhost:5080` ให้แล้ว (รวม `ws: true`
สำหรับ SignalR) ตอน dev จึงเห็น origin เดียวเหมือน production → ไม่เจอ CORS ต่างกัน

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
└─ web/                        ← Vite + React 19
    └─ src/
        ├─ lib/                ← apiClient, queryClient, cn()
        ├─ components/{ui,common,layout}/
        ├─ features/<domain>/{service,hooks,components}/ + index.ts
        ├─ page/               ← ประกอบ route เท่านั้น
        ├─ realtime/           ← SignalRProvider (Phase 2)
        └─ app/                ← App.tsx, routes.tsx
```

---

## Architecture gates

กฎ layer ที่ไม่มีเครื่องบังคับคือของประดับ กฎในโปรเจกต์นี้บังคับด้วย CI ทุกข้อ
และ **ทุก gate ถูกทดสอบแล้วว่าแดงจริง** ก่อนถูก commit

```bash
node scripts/check-architecture.mjs    # ฝั่ง api  (7 gates)
cd web && npm run lint                 # ฝั่ง web  (layer boundaries + axios)
```

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

## สถานะ

**Phase 0 เสร็จ** — scaffolding, infra, CI gates ทั้ง 13 ตัวทดสอบแล้ว, health check วิ่งผ่าน
layer ครบ (Controller → Repository → PostgreSQL)

**ถัดไป: Phase 1** — walking skeleton: register → login → สร้าง workspace → nested page
ใน sidebar → พิมพ์ใน BlockNote → refresh แล้วเนื้อหายังอยู่

ดู phase ทั้งหมดและ risk ที่รออยู่ใน [PLAN.md](PLAN.md)

### หนี้ที่รู้ตัวแล้ว

- bundle 525 kB (gzip 171 kB) ตั้งแต่ Phase 0 — ต้องทำ `manualChunks` แยก
  BlockNote / Yjs / motion ออกใน Phase 1 ก่อนที่มันจะโตกว่านี้
- `MaximumReceiveMessageSize` ตั้งไว้ 4 MB แล้วแต่ยังไม่มี hub ให้ทดสอบ — ต้องยืนยัน
  ตอน Phase 2 ว่า client ที่ offline กลับมา push full state ได้จริง
