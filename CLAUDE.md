# CLAUDE.md — กติกาสำหรับ AI ใน repo นี้

ProjectManagement — self-hosted collaborative workspace (Notion-style): nested pages,
block editor (BlockNote + Yjs), งาน todo/doing/done, multi-tenant ด้วย PostgreSQL RLS
ติดตั้ง/รัน dev อ่าน `README.md` ก่อนเสมอ — ไฟล์นี้คือกติกาและแผนที่ ไม่ใช่คู่มือติดตั้ง

| | |
|---|---|
| ระบบจริง (production) | `https://maps.bevproasia.com:4090` — Docker บน Synology NAS `10.10.199.16` |
| มาตรฐานเอกสาร | `docs/ST-documentation-standard.md` — ชื่อไฟล์ต้องเป็น `<PREFIX>-<slug>.md` |

## โครง repo

| โฟลเดอร์ | คือ |
|---|---|
| `server/` | API จริง — NestJS 11 + Drizzle + PostgreSQL 18 (PGroonga) |
| `web/` | React 19 + Vite + BlockNote `0.52.1` (pin เป๊ะ ห้ามใส่ `^`) + nginx (proxy `/api`) |
| `mcp/` | MCP server (C#) ให้ Claude Code สั่งงานแอปผ่าน REST API — ไม่แตะฐานข้อมูลเอง |
| `api/` | ⚠️ .NET รุ่นเก่า **ถูกแทนด้วย `server/` แล้ว** — อย่าแก้ อย่าใช้เป็นตัวอย่าง |
| `docs/` | เอกสารตามมาตรฐาน ST · `.claude/skills/pm-tasks/` คือคู่มือใช้ MCP |

## คำสั่งที่ใช้จริง

```bash
npm --prefix server run dev        # dev API ที่ :5081 (ต้องมี postgres จาก docker compose)
npm --prefix server run check      # ทุกอย่างที่ CI รัน: typecheck + arch gates + lint + test — รันก่อน push เสมอ
npm --prefix server run db:setup   # migrate + objects.sql (ฐาน NAS: ตั้ง DATABASE_ADMIN_URL/DATABASE_URL ชี้ 10.10.199.16:5440)
npm --prefix web run build         # typecheck + build ฝั่งเว็บ
dotnet build mcp -c Release        # MCP — ทำไม่ได้ตอน Claude Code เปิดอยู่ (dll ถูกล็อก) ใช้ pwsh scripts/setup-mcp.ps1 หลังปิดโปรแกรม
```

หมายเหตุ test: suite ที่ต้องต่อฐาน (rls, auth, pages, …) fail ถ้าไม่มี `DATABASE_URL` ใน env —
ถ้าแก้เฉพาะส่วนไม่แตะฐาน รัน `npx vitest run test/<file>.spec.ts` เจาะไฟล์ได้

## Deploy ขึ้น NAS

**NAS build image เองไม่ได้** (network บล็อก apt) — build บน PC เท่านั้น:

```bash
docker build -t projectmanagement-api:latest ./server     # และ/หรือ projectmanagement-web:latest ./web
docker save <image> | gzip | ssh -i ~/.ssh/pm_nas_key BevproAdmin@10.10.199.16 "cat > /volume1/docker/projectmanagement/pm-api.tar.gz"
# บน NAS (sudo ต้องใช้รหัสผ่าน): docker load -i ... && docker compose up -d api web   # ห้าม --build
```

compose ฝั่ง NAS อยู่ `/volume1/docker/projectmanagement/` — patch ต่างจาก repo (web เป็น `8090:80`)
แก้ compose ใน repo แล้วต้องตามไปแก้ฝั่ง NAS ด้วย · โฟลเดอร์ `uploads/` บน NAS ต้อง uid 1000 เขียนได้
(Synology ACL ทับ POSIX ได้ — ถ้า container เขียนไม่ได้ทั้งที่ chown แล้ว ให้ `chmod` เพื่อล้าง ACL)

## ข้อห้าม / กับดักที่เจอมาแล้วจริง

- **ห้าม commit secret** — รหัส/token เขียนได้แค่ชื่อ key แล้วชี้ว่าอยู่ที่ไหน (`.env`, user secrets) · หลุดแล้ว = rotate ทันที
- **อ่าน `process.env` ได้ที่ `server/src/config/env.ts` ที่เดียว** — arch gate บังคับอยู่
- **Controller ห้าม query เอง** — ลำดับชั้น controller → service (คืน `Result<T>`) → repository (SQL อยู่ที่นี่เท่านั้น)
- **RLS คือกำแพง tenant** — API ต่อฐานด้วย role `pm_app` เท่านั้น ใส่ superuser = policy ถูกข้ามเงียบ ๆ
- **ตัวสกัด plain text มี 3 จุดที่ต้องตรงกันเป๊ะ** (`readPlainText`/`blocksToPlainText` ใน `server/src/documents/blocknote.ts` + `blocksToPlainText` ใน `web/.../PageEditor.tsx`) — แก้ตัวเดียว index ค้นหาจะสลับค่าไปมา
- **dependency ที่ runtime ใช้ต้องอยู่ `dependencies`** — `npm prune --omit=dev` ใน Dockerfile ตัด devDependencies ออกจริง (linkedom เคยพังบน NAS มาแล้ว)
- แก้โค้ด `mcp/` แล้ว `.mcp.json` ยังชี้ dll เก่า — ต้อง rebuild + เปิด Claude Code ใหม่ ไม่งั้นได้ tool ชุดเก่าเงียบ ๆ
- commit message เขียนภาษาไทยตามสไตล์ repo (ดู `git log`) — โค้ด/ชื่อไฟล์เป็นอังกฤษ

## แก้โค้ดตรงไหน ต้องอัปเดตเอกสารตรงไหน (traceability)

PR ที่แก้โค้ดโดยไม่แก้เอกสารที่ผูกกัน ถือว่ายังไม่เสร็จ

| แก้อะไร | ต้องอัปเดตด้วย |
|---|---|
| เพิ่ม/แก้ MCP tool หรือพฤติกรรม (`mcp/`, `server/src/documents/`) | `mcp/README.md` + `.claude/skills/pm-tasks/SKILL.md` + rebuild dll |
| เพิ่ม/แก้ endpoint หรือ contract ใน `server/src/*/` | `mcp/README.md` (ถ้า MCP ใช้) — ยังไม่มี `AS-*` ถ้าเริ่มเขียนให้วางใน `docs/` |
| เพิ่ม config key / env | `README.md` + `.env.example` + `docker-compose.yml` (repo และฝั่ง NAS) |
| แก้ `docker-compose.yml` / `web/nginx.conf` | ตามไปแก้ compose ฝั่ง NAS + `docs/RB-*` (ถ้ามี) |
| แก้ schema ฐานข้อมูล | drizzle migration (`db:generate`) — ห้าม `drizzle-kit push` |
| ตัดสินใจเชิงสถาปัตยกรรม | `AD-*` ฉบับใหม่ใน `docs/` — ไม่แก้ทับฉบับเก่า |

## แผนที่เอกสาร

| ไฟล์ | เรื่อง |
|---|---|
| `README.md` | ติดตั้ง · รัน dev · env ที่ต้องตั้ง |
| `PLAN.md` / `PLAN-node.md` | สถาปัตยกรรม + phase (PLAN-node = การย้าย .NET → Node) |
| `docs/ST-documentation-standard.md` | มาตรฐานชื่อไฟล์/โครงเอกสารของทีม |
| `docs/RB-connect-ai.md` | ขั้นตอนเชื่อม Claude Code เข้าระบบผ่าน MCP (ติดตั้งต่อเครื่อง) |
| `docs/deploy-iis.md` | เอกสารเดิมก่อนมาตรฐาน ST — แตะเมื่อไหร่ให้ rename เป็น prefix ตามมาตรฐาน |
| `mcp/README.md` | สัญญาของ MCP ↔ API ฉบับเต็ม |
| `.claude/skills/pm-tasks/SKILL.md` | คู่มือ AI ใช้ MCP (โหลดเข้า session อัตโนมัติ) |
