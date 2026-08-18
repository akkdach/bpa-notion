# ProjectManagement

Self-hosted collaborative workspace — nested pages, block editor, realtime collaboration,
and Notion-style databases. Multi-tenant, on-prem.

แผนงานฉบับเต็มอยู่ใน **[PLAN.md](PLAN.md)** — สถาปัตยกรรม, schema, phase, ความเสี่ยง

| | |
|---|---|
| **Backend** | NestJS 11 (Node 22, ESM) · Drizzle + `pg` · **RLS** เป็นตัวบังคับ tenant · argon2 + JWT |
| **Frontend** | React 19 · Vite 7 · TypeScript · Tailwind v4 · shadcn/ui · Framer Motion (`motion`) |
| **Editor** | BlockNote `0.52.1` (Tiptap/ProseMirror ข้างใน) + Yjs CRDT |
| **Database** | PostgreSQL 18 + **PGroonga** (full-text search ภาษาไทย) |
| **Deploy** | Docker Compose → on-prem |

---

## เริ่มต้น

```bash
cp .env.example .env
```

แก้ `.env` อย่างน้อย 3 ค่า:

```bash
POSTGRES_PASSWORD=<ตั้งใหม่>             # บัญชี owner ของฐาน — ใช้ตอน migrate เท่านั้น
APP_DB_PASSWORD=<ตั้งใหม่>               # บัญชีที่ API ใช้ตอนรัน (pm_app)
JWT_SECRET=<openssl rand -base64 48>     # ต้อง >= 32 bytes ไม่งั้น API ไม่ start
```

> **ทำไมมีสองรหัส** — API ต่อฐานด้วย role `pm_app` ที่ไม่ใช่ owner และไม่มี `BYPASSRLS`
> เพราะ **RLS ไม่มีผลกับ superuser เลย** ถ้าใส่บัญชี `postgres` ให้ API ทุก policy จะ
> ถูกข้ามโดยไม่มีอาการอะไรให้เห็น จนกว่าจะมีลูกค้าที่สอง — `DbService` จึงตรวจข้อนี้
> ตอนบูตและปฏิเสธที่จะขึ้นถ้า role ผิด

```bash
docker compose up -d --build --wait
npm --prefix server run db:setup      # สร้าง role pm_app + ลง schema + sql/objects.sql
```

| URL | คือ |
|---|---|
| http://localhost | เว็บ (nginx เสิร์ฟ SPA + proxy `/api`) |
| http://localhost/api/v1/health | health check ผ่าน nginx |
| http://localhost:5080 | API ตรง ๆ (Swagger UI ที่ `/api/v1/docs` ตอน `NODE_ENV != production`) |
| `localhost:5440` | PostgreSQL |

> **ทำไม 5440 ไม่ใช่ 5432** — เครื่อง dev มักมี PostgreSQL ของตัวเองอยู่บน 5432 แล้ว
> ถ้าใช้ port ชนกัน อย่างดีคือ bind ไม่ติด อย่างแย่คือ `db:setup` ไปลง schema ผิดฐาน
> โดยไม่มีใครรู้ ตั้งค่าได้ที่ `POSTGRES_HOST_PORT` ใน `.env`
> (ไม่ใช้ 5433 ด้วย เพราะเป็นเลขที่ compose project อื่นเลือกกันบ่อย)

### พัฒนาแบบไม่ผ่าน Docker

```bash
docker compose up -d postgres              # เอาแค่ฐานข้อมูล

cd server && cp .env.example .env          # แก้รหัสให้ตรงกับ ../.env
npm install && npm run db:setup
npm run dev                                # → http://localhost:5081

cd ../web && npm install && npm run dev    # → http://localhost:5173
```

`vite.config.ts` proxy `/api` ไป `localhost:5081` ให้แล้ว ตอน dev จึงเห็น origin เดียว
เหมือน production → ไม่เจอ CORS ต่างกัน

> **5081 ไม่ใช่ 5080** — 5080 คือ container `pm-api` ที่ compose รันอยู่ ถ้า `npm run dev`
> ไปฟังทับ จะได้อาการที่ debug ยากมาก: โค้ดใหม่ที่แก้แล้วไม่มีผล เพราะเบราว์เซอร์คุยกับ
> container รุ่นเก่าอยู่

---

## Configuration — ค่าไหนมาจากไหน

ทุกค่าเป็น environment variable และถูกอ่าน **ที่เดียว** คือ `server/src/config/env.ts`
ซึ่ง validate ด้วย zod ตอนบูต — env ที่หายไปทำให้ process ไม่ขึ้นเลย ไม่ใช่ทำให้ request
ที่ 500 ในอีกสามชั่วโมง (`scripts/check-architecture.mjs` บังคับกฎนี้)

| ตัวแปร | ใช้ตอน | ใคร |
|---|---|---|
| `DATABASE_URL` | ทุก request | `pm_app` — ไม่ใช่ owner ไม่มี BYPASSRLS |
| `DATABASE_ADMIN_URL` | `db:setup` / `db:generate` เท่านั้น | owner (`postgres`) |
| `JWT_SECRET` · `JWT_ISSUER` | ออก/ตรวจ token | — |
| `WEB_ORIGIN` | CORS | — |

> **runtime ไม่ได้รับ `DATABASE_ADMIN_URL`** — ดูใน `docker-compose.yml` จะไม่มีตัวแปรนี้
> ส่งให้ container เลย การ migrate เป็นงานที่รันแยก การบังคับให้ container ที่เสิร์ฟ
> request ถือรหัส owner คือการแจกของที่ไม่ควรแจก

บนเครื่อง dev ค่าอยู่ใน `server/.env` (gitignored) — `server/.env.example` เป็นตัวอย่าง
และมี gate ตรวจว่าไม่มีค่าลับจริงหลุดลงไป

### ชี้ไปที่ PostgreSQL ที่ไม่ใช่ Docker

เซิร์ฟเวอร์ปลายทางต้องมี **PGroonga** ติดตั้งอยู่ก่อน — เป็น binary ฝั่ง server สั่ง
`CREATE EXTENSION` เฉย ๆ ไม่พอ ตรวจได้ด้วย
`SELECT * FROM pg_available_extensions WHERE name = 'pgroonga'` ถ้าไม่มี `sql/objects.sql`
จะพังกลางคันตอนสร้าง index (และ `/api/v1/health` ตอบ 503 พร้อมบอกว่า extension ไหนหาย)

```bash
psql "$DATABASE_ADMIN_URL" -f db/init/001_extensions.sql   # สร้าง 3 extension
npm --prefix server run db:setup                           # ลง schema + RLS
psql "$DATABASE_ADMIN_URL" -f db/probe/thai-search-probe.sql   # ต้อง PASS ครบ 10
```

> `db/init/*.sql` ถูกรันอัตโนมัติเฉพาะตอน Docker สร้าง volume ใหม่เท่านั้น ปลายทาง
> อื่นไม่มีอะไรรันให้

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
├─ server/                     ← NestJS (ESM) — ตัวที่ deploy จริง
│   ├─ src/main.ts             ← bootstrap เท่านั้น
│   ├─ src/bootstrap.ts        ← ตั้งค่าที่ production กับเทสต้องเหมือนกัน
│   ├─ src/db/                 ← schema.ts (Drizzle) + DbService (RLS scope + ธุรกรรม)
│   ├─ src/common/             ← Result, envelope, zod pipe, request context
│   ├─ src/<domain>/           ← controller · service · repository · schema ต่อโดเมน
│   ├─ sql/objects.sql         ← ทุกอย่างที่ Drizzle เขียนไม่ได้ (RLS, PGroonga, CHECK)
│   ├─ drizzle/                ← migration ที่ generate แล้ว
│   └─ test/                   ← ยิง HTTP จริงกับฐานจริง ไม่มี mock
├─ api/                        ← ⚠️ ASP.NET Core เดิม — ทางถอย ไม่ใช่ของที่ deploy
├─ web/                        ← Vite + React 19
│   └─ src/
│       ├─ lib/                ← apiClient, queryClient, cn()
│       ├─ components/{ui,common,layout}/
│       ├─ features/<domain>/{service,hooks,components}/ + index.ts
│       ├─ page/               ← ประกอบ route เท่านั้น
│       └─ app/                ← App.tsx, routes.tsx
├─ mcp/                        ← MCP server ให้ Claude Code สั่งงานแอปได้ (ดู mcp/README.md)
└─ .mcp.json                   ← Claude Code อ่านไฟล์นี้เพื่อรู้จัก MCP server ข้างบน
```

> **เชื่อมต่อ AI เข้ากับระบบ** — ทำตาม [`docs/connect-ai.md`](docs/connect-ai.md)
> (คู่มือสำหรับผู้ใช้/ลูกค้า) ส่วนรายละเอียดเชิงเทคนิคอยู่ใน [`mcp/README.md`](mcp/README.md)

> **deploy ขึ้น IIS แทน docker** — ดู [`docs/deploy-iis.md`](docs/deploy-iis.md)
> ต่างกันหลายเรื่องพอที่จะทำตามคู่มือหลักตรง ๆ แล้วพัง (App Pool ต้องเป็น 64-bit
> ไม่งั้น native library ของ Yjs โหลดไม่ขึ้น · ไม่มี `try_files` ต้องเขียน rewrite rule เอง
> · PostgreSQL + PGroonga ต้องลงแยก)

> `mcp/` คุยกับแอปผ่าน REST API เหมือน client ทั่วไป **ไม่แตะฐานข้อมูลเอง** จึงได้
> tenant isolation และ permission check ชุดเดียวกับที่เว็บได้ ไม่ต้องเขียนซ้ำ

---

## Architecture gates

กฎ layer ที่ไม่มีเครื่องบังคับคือของประดับ กฎในโปรเจกต์นี้บังคับด้วย CI ทุกข้อ
และ **ทุก gate ถูกทดสอบแล้วว่าแดงจริง** ก่อนถูก commit

```bash
cd server && npm run check             # typecheck + 9 gates + eslint + 160 เทส
node scripts/check-architecture.mjs    # ฝั่ง api เดิม (ทางถอย — 7 gates)
cd web && npm run lint                 # ฝั่ง web  (layer boundaries + axios)
```

สคริปต์ใน `scripts/` ที่ยิงของจริงรันใน CI job ชื่อ `verify` (ต้องมี API ขึ้นก่อน):

```bash
npm --prefix server run dev                     # ต้องเปิดค้างไว้
node scripts/smoke-test.mjs                     # REST ตั้งแต่ register ถึงแก้เนื้อหา
node scripts/verify-ydoc.mjs                    # Y.Doc → bytea → bootstrap
node scripts/verify-repair.mjs                  # ทำ denormalise เพี้ยนแล้วซ่อม
node scripts/verify-mcp.mjs                     # JSON-RPC กับ MCP server จริง
cd web && npx playwright test                   # เบราว์เซอร์จริง
```

> ก่อนหน้านี้ **ไม่มี job ไหนใน CI รันสคริปต์พวกนี้หรือ playwright เลย**
> `smoke-test.mjs` มี `check()` 116 ข้อที่ไม่มีใครบังคับ — เขียนไว้แล้วพังได้เงียบ ๆ

### ฝั่ง Server

`server/scripts/check-architecture.mjs` — 9 ข้อ ทุกข้อลองทำผิดกฎแล้วดูว่ามันยิงจริง

| Gate | เหตุผล |
|---|---|
| Controller ไม่แตะฐานข้อมูลเอง | query ที่เขียนตรงใน controller คือ query ที่ข้ามการตรวจสิทธิ์ของ service |
| Service ไม่เขียน query เอง | business logic คุยผ่าน repository — ไม่งั้นไม่มีที่เดียวให้ review ว่าอ่านอะไรบ้าง |
| raw SQL อยู่ใน repository เท่านั้น | SQL ที่กระจายทั่วโค้ดคือ SQL ที่ไม่มีใครไล่อ่านครบตอนแก้ schema |
| `unscopedPool` · `withOwnTransaction` · `withoutTenant` จำกัดที่ผู้เรียก | สามตัวนี้ทำงานนอกขอบเขต RLS — ทุกจุดที่เรียกต้องมีเหตุผลที่ review แล้ว |
| อ่าน `process.env` ที่ `config/env.ts` ที่เดียว | env ที่หายไปต้องทำให้ process ไม่ขึ้นเลย ไม่ใช่ 500 ในอีกสามชั่วโมง |
| ไม่มี CORS ที่เปิดทุก origin | คู่กับ `credentials: true` = เปิดให้ทุกเว็บยิงแทนผู้ใช้ |
| ไม่มี connection string hardcode | secret มาจาก env เท่านั้น |
| `package.json` ไม่มี `drizzle-kit push` | push เทียบกับฐานจริงแล้วเสนอ DROP ทุกอย่างที่ไม่มีใน `schema.ts` — **รวม RLS policy ทั้งหมด** |
| `.env.example` ไม่มีค่าลับจริง | ไฟล์นี้ขึ้น git — เรียกคืนจาก git ไม่ได้ |

> **กฎที่หายไปจากรุ่น .NET** — "ห้าม `IgnoreQueryFilters()` แบบไม่ระบุชื่อ" เป็นกฎที่
> สำคัญที่สุดในชุดเดิม เพราะมันคือวิธีที่ tenant leak หลุด production ตอนนี้ไม่มีอะไร
> ให้ตรวจแล้ว: Drizzle ไม่มี query filter ให้ปิด และ **RLS ปิดจากฝั่งโค้ดไม่ได้เลย**
> ทางลัดที่ยังเหลืออยู่คือสามตัวข้างบน ซึ่งมี gate ของตัวเอง

นอกจากนี้ `eslint` จับสิ่งที่ต้องรู้ชนิดถึงจะตรวจได้ — โดยเฉพาะ
`no-floating-promises` เพราะทุก query อยู่ในธุรกรรมที่มีอายุจำกัด promise ที่ลืม
`await` จะทำงานต่อ **หลัง** ธุรกรรม commit ไปแล้ว โดยไม่มี error ให้เห็น

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
# server
cd server
npm run dev                                    # watch mode → localhost:5081
npm run check                                  # typecheck + gates + lint + test
npm run db:generate                            # schema.ts เปลี่ยน → migration ใหม่
npm run db:setup                               # ลง migration + sql/objects.sql (รันซ้ำได้)

# ⚠️ ห้าม drizzle-kit push — มันเสนอ DROP ทุกอย่างที่ไม่มีใน schema.ts
#    ซึ่งรวม RLS policy ทั้งหมด (มี gate กันไว้แล้ว)

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
- **`Result<T>` สำหรับ failure ที่คาดไว้** exception ไว้ใช้กับบั๊กจริง ๆ — อ่าน
  signature แล้วรู้เลยว่าฟังก์ชันล้มเหลวได้แบบไหน controller เรียก `unwrap()`
  ที่ขอบเพื่อแปลงเป็น HTTP
- **หนึ่ง request = หนึ่งธุรกรรม** เปิดโดย `RequestContextInterceptor` ผลพลอยได้คือ
  handler ที่เขียนหลายตารางแล้วพังกลางทาง rollback ทั้งหมดโดยไม่ต้องเขียนอะไรเพิ่ม
  ⚠️ ราคาที่ต้องรู้: ทางที่จบด้วยความล้มเหลวจะ rollback สิ่งที่ตั้งใจเขียนตอนล้มเหลว
  ด้วย (เช่นการเพิกถอน token ที่รั่ว) — ใช้ `withOwnTransaction` เมื่อต้องให้อยู่รอด

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

**ย้าย API จาก ASP.NET Core มาเป็น NestJS เสร็จแล้ว** — ดู [PLAN-node.md](PLAN-node.md)

| | |
|---|---|
| `server/` typecheck · eslint · build | ✅ |
| Architecture gates 9 ข้อ | ✅ ทุกข้อพิสูจน์แล้วว่ายิงจริงเมื่อละเมิด |
| เทส 160 ข้อ (ยิง HTTP จริง + ฐานจริง ไม่มี mock) | ✅ |
| `scripts/smoke-test.mjs` (เขียนไว้สำหรับ .NET) | ✅ **121/121** — สัญญาของ API ไม่เปลี่ยน |
| RLS: 10 ตาราง · FORCE · `pm_app` ไม่ใช่ superuser | ✅ ปิด RLS หนึ่งตาราง → เทสแดง 15 ข้อ |
| PGroonga ค้นไทยกลางประโยค (bigram) | ✅ `ข้าวผัด` `กระเพรา` `ไก่` เจอครบ |
| fractional index ตรงกับ fixture เดิม | ✅ 4,701/4,701 เคส |
| BlockNote + Yjs ฝั่งเซิร์ฟเวอร์ | ✅ ใช้ parser/schema ตัวจริง — ไม่ต้องพอร์ตเอง |

**ที่ยังไม่ได้ทำ**

- `api/` ยังอยู่เป็นทางถอย (rollback = สลับ compose กลับ) — ลบเป็นขั้นตอนสุดท้าย
- realtime ยังไม่ได้ต่อ — `web/src/realtime/` ว่างเปล่ามาตั้งแต่ต้น ไม่เคยใช้ SignalR จริง
  ตอนนี้ Yjs วิ่งผ่าน REST (`/ydoc`, `/ydoc/update`) ซึ่งเป็นทางที่ web ใช้อยู่แล้ว
- `mcp/` ยังเป็น .NET — คุยกับ API ผ่าน REST จึงไม่ต้องรีบย้าย

ดู phase ทั้งหมดและ risk ที่รออยู่ใน [PLAN.md](PLAN.md)

### หนี้ที่รู้ตัวแล้ว

- bundle 525 kB (gzip 171 kB) ตั้งแต่ Phase 0 — ต้องทำ `manualChunks` แยก
  BlockNote / Yjs / motion ออกใน Phase 1 ก่อนที่มันจะโตกว่านี้
- `MaximumReceiveMessageSize` ตั้งไว้ 4 MB แล้วแต่ยังไม่มี hub ให้ทดสอบ — ต้องยืนยัน
  ตอน Phase 2 ว่า client ที่ offline กลับมา push full state ได้จริง
- ยังไม่มี test project — Phase 1 ต้องเริ่มด้วย `tests/ProjectManagementAPI.Tests/`
  พร้อม `[Theory]` route table สำหรับ tenant isolation (CI workflow เตรียม step ไว้แล้ว)
- PGroonga ยังทดสอบแค่ corpus 5 แถว — Phase 6 ต้องวัด recall และขนาด index ที่ ~2,000 หน้า
