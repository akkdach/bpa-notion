// ═══════════════════════════════════════════════════════════════════════════
//  db:setup — ทำให้ฐานพร้อมใช้ในคำสั่งเดียว รันซ้ำได้เสมอ
//
//    1. สร้าง/ปรับ role pm_app ให้ตรงกับ DATABASE_URL
//    2. drizzle migrate  (ตาราง, PK, FK, index ธรรมดา)
//    3. sql/objects.sql  (constraint, partial/GIN/PGroonga index, COLLATE, RLS)
//
//  ⚠️ ลำดับสำคัญ: objects.sql เรียก GRANT … TO pm_app จึงต้องมี role ก่อน
//     และ ALTER TABLE ต้องมีตารางก่อน
// ═══════════════════════════════════════════════════════════════════════════

import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');

/** ชื่อ role ที่ runtime ใช้ — hardcode ไว้ใน sql/objects.sql ด้วย */
const APP_ROLE = 'pm_app';

async function main(): Promise<void> {
  const adminUrl = required('DATABASE_ADMIN_URL');
  const runtimeUrl = required('DATABASE_URL');

  const runtime = new URL(runtimeUrl);
  const roleName = decodeURIComponent(runtime.username);
  const rolePassword = decodeURIComponent(runtime.password);

  // ─────────────────────────────────────────────────────────────────────
  //  ⚠️ ตรวจตั้งแต่ก่อนแตะฐาน — DATABASE_URL ที่ชี้ไป superuser คือความผิดพลาด
  //     ที่ไม่แสดงอาการเลยจนกว่าจะมี tenant ที่สอง
  // ─────────────────────────────────────────────────────────────────────
  if (roleName !== APP_ROLE) {
    fail(
      `DATABASE_URL ต้องต่อด้วย role "${APP_ROLE}" แต่ได้ "${roleName}"\n` +
        `  runtime ต้องเป็น role ที่ไม่ใช่ owner ไม่งั้น RLS policy จะถูกข้ามทั้งหมด`,
    );
  }
  if (!rolePassword) {
    fail(`DATABASE_URL ต้องมีรหัสผ่านของ ${APP_ROLE} — สคริปต์นี้ใช้ค่านั้นตั้งให้ role ด้วย`);
  }

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    await ensureRole(admin, roleName, rolePassword);

    console.log('▸ drizzle migrate');
    const db = drizzle(admin);
    await migrate(db, { migrationsFolder: join(serverRoot, 'drizzle') });

    console.log('▸ sql/objects.sql');
    const objects = await readFile(join(serverRoot, 'sql', 'objects.sql'), 'utf8');
    await admin.query(objects);

    await report(admin);
  } finally {
    await admin.end();
  }
}

/**
 * ⚠️ ระบุ NOSUPERUSER NOBYPASSRLS ทุกครั้ง ไม่ใช่แค่ตอนสร้าง
 *
 * ถ้ามีคนเผลอ ALTER ROLE pm_app SUPERUSER ไว้เพื่อ debug แล้วลืมถอด
 * การรัน db:setup ครั้งถัดไปจะดึงกลับมาเอง — ซึ่งดีกว่าปล่อยให้ค้างไว้เงียบ ๆ
 */
async function ensureRole(admin: pg.Client, role: string, password: string): Promise<void> {
  const { rowCount } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);

  const ident = quoteIdent(role);
  const secret = quoteLiteral(password);

  if (rowCount === 0) {
    console.log(`▸ สร้าง role ${role}`);
    await admin.query(
      `CREATE ROLE ${ident} LOGIN PASSWORD ${secret} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  } else {
    console.log(`▸ ปรับ role ${role} ให้ตรงกับ .env`);
    await admin.query(
      `ALTER ROLE ${ident} WITH LOGIN PASSWORD ${secret} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  }

  await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdent(admin.database ?? 'postgres')} TO ${ident}`);
}

/**
 * รายงานสิ่งที่ตรวจสอบได้ ไม่ใช่แค่ "สำเร็จ"
 *
 * ตัวเลขสามบรรทัดนี้คือสิ่งที่บอกได้ว่า RLS ติดจริงไหม — "ไม่มี error"
 * ไม่ได้แปลว่า policy ทำงาน (ดู PLAN-node.md ข้อ 2)
 */
async function report(admin: pg.Client): Promise<void> {
  const { rows } = await admin.query<{ relname: string; rowsecurity: boolean; forced: boolean; policies: number }>(`
    SELECT c.relname,
           c.relrowsecurity      AS rowsecurity,
           c.relforcerowsecurity AS forced,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname
  `);

  const guarded = rows.filter((r) => r.rowsecurity);
  const open = rows.filter((r) => !r.rowsecurity).map((r) => r.relname);

  console.log(`\n✓ ตาราง ${rows.length} ตาราง · มี RLS ${guarded.length} ตาราง`);
  for (const r of guarded) {
    console.log(`    ${r.relname.padEnd(22)} force=${r.forced ? 'yes' : 'NO ⚠️'}  policy=${r.policies}`);
  }
  console.log(`  ไม่มี RLS (ตั้งใจ): ${open.join(', ')}`);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) fail(`ต้องมี ${name} — cp .env.example .env`);
  return v;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** ชื่อ role มาจาก .env ไม่ใช่จากผู้ใช้ แต่ CREATE ROLE รับ parameter ไม่ได้ */
const quoteIdent = (s: string) => `"${s.replaceAll('"', '""')}"`;
const quoteLiteral = (s: string) => `'${s.replaceAll("'", "''")}'`;

await main();
