// ═══════════════════════════════════════════════════════════════════════════
//  RLS — ประตูที่ต้องผ่านก่อนเขียน endpoint แรก (PLAN-node.md ข้อ 2)
//
//  ทำไมเทสชุดนี้ถึงหน้าตาแปลกกว่าเทสอื่น: RLS พังแบบ "ดูเหมือนผ่านหมด"
//
//    · ต่อฐานด้วย superuser → ทุก policy ถูกข้าม ทุก query คืนข้อมูลครบ
//      ทุกเทสที่ใช้ tenant เดียวผ่านหมด
//    · ลืม FORCE → owner ไม่ถูกกรอง แต่ role อื่นถูก จึงผ่านบนเครื่อง dev
//      แล้วพังบน prod (หรือกลับกัน ซึ่งแย่กว่า)
//    · ใช้ SET แทน SET LOCAL → ค่าติดค้างกับ connection ใน pool ซึ่ง**จะไม่
//      แสดงอาการเลย**ถ้าเทสเปิด connection ใหม่ทุกครั้ง
//
//  เทสชุดนี้จึงตรวจ "คุณสมบัติของฐาน" ตรง ๆ ด้วย ไม่ใช่แค่ยิง query แล้วดูผล
//  และบังคับ pool ให้เหลือ connection เดียวเพื่อให้การรั่วข้าม request
//  เป็นสิ่งที่ *ต้อง* โผล่ ไม่ใช่ *อาจ* โผล่
// ═══════════════════════════════════════════════════════════════════════════

import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ⚠️ ต้องตั้งก่อน import DbService — loadEnv() cache ค่าไว้ตั้งแต่ครั้งแรก
//    max=1 คือหัวใจของเทสนี้: ทุกธุรกรรมได้ connection ตัวเดียวกันเสมอ
process.env['DATABASE_POOL_MAX'] = '1';

const { DbService } = await import('../src/db/db.service.js');
const { TENANT_TABLES, pages, workspaceMembers, workspaces } = await import('../src/db/schema.js');

type Ids = {
  userA: string;
  userB: string;
  wsA: string;
  wsB: string;
  pageA: string;
  pageB: string;
};

let admin: pg.Client;
let db: InstanceType<typeof DbService>;
const ids: Ids = {
  userA: randomUUID(),
  userB: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  pageA: randomUUID(),
  pageB: randomUUID(),
};

/** slug ต้องผ่าน ck_workspaces_slug_format และต้องไม่ชนกับข้อมูลที่มีอยู่ */
const slug = (id: string) => `t-${id.slice(0, 8)}`;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: process.env['DATABASE_ADMIN_URL'] });
  await admin.connect();

  // seed ด้วยบัญชี owner เพราะ RLS ยังไม่มี tenant ให้ตั้ง — และเพราะเรา
  // ต้องการข้อมูลของ "อีก workspace" ที่ฝั่ง runtime ไม่ควรมีทางสร้างเองได้
  for (const [user, ws, page] of [
    [ids.userA, ids.wsA, ids.pageA],
    [ids.userB, ids.wsB, ids.pageB],
  ] as const) {
    await admin.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'test')`,
      [user, `${user}@example.test`],
    );
    await admin.query(`INSERT INTO workspaces (id, slug, name, created_by) VALUES ($1, $2, 'test', $3)`, [
      ws,
      slug(ws),
      user,
    ]);
    await admin.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      ws,
      user,
    ]);
    await admin.query(
      `INSERT INTO pages (id, workspace_id, rank, kind, access_root_id, title)
       VALUES ($1, $2, 'a0', 'page', $1, 'หน้าแรก')`,
      [page, ws],
    );
  }

  db = new DbService();
});

afterAll(async () => {
  await db?.close();
  await admin.query(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.userA, ids.userB]]);
  await admin.end();
});

// ═══════════════════════════════════════════════════════════════════════════
//  ชั้นที่ 1 — ฐานถูกตั้งค่าถูกจริงไหม
//
//  ถ้าสามข้อนี้ผิด เทสที่เหลือทั้งหมด "ผ่าน" ได้โดยไม่มีความหมายอะไรเลย
// ═══════════════════════════════════════════════════════════════════════════
describe('การตั้งค่าของฐาน', () => {
  it('role ที่ runtime ใช้ ไม่ใช่ superuser และไม่มี BYPASSRLS', async () => {
    // ผ่าน DbService เพื่อให้เช็คตัวเดียวกับที่รันตอนบูตจริง
    await expect(db.onModuleInit()).resolves.toBeUndefined();

    const { rows } = await db.withoutTenant(async (s) =>
      s.client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>(
        `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      ),
    );

    expect(rows[0]?.rolname).toBe('pm_app');
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('ทุกตารางใน TENANT_TABLES เปิด RLS + FORCE + มี policy', async () => {
    const { rows } = await admin.query<{
      relname: string;
      rowsecurity: boolean;
      forced: boolean;
      policies: number;
    }>(
      `SELECT c.relname,
              c.relrowsecurity      AS rowsecurity,
              c.relforcerowsecurity AS forced,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [[...TENANT_TABLES]],
    );

    expect(rows).toHaveLength(TENANT_TABLES.length);
    for (const r of rows) {
      expect(r, `${r.relname} ต้องเปิด RLS`).toMatchObject({ rowsecurity: true, forced: true });
      expect(r.policies, `${r.relname} ต้องมี policy อย่างน้อยหนึ่งข้อ`).toBeGreaterThan(0);
    }
  });

  it('ตารางที่มี workspace_id แต่ไม่อยู่ใน TENANT_TABLES ต้องเป็นข้อยกเว้นที่ตั้งใจ', async () => {
    // ⚠️ เทสข้อนี้คือสิ่งที่จับ "เพิ่มตารางใหม่แล้วลืมใส่ policy" ซึ่งเป็นทาง
    //    ที่ tenant isolation หายไปทีละตารางโดยไม่มีใครสังเกต
    const { rows } = await admin.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'workspace_id' AND a.attnum > 0
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
    );

    // api_tokens เป็นข้อยกเว้นเดียว: การ resolve token เกิดก่อนที่จะรู้ว่า
    // workspace ไหน (workspace มาจากตัว token เอง) ดูคอมเมนต์ใน sql/objects.sql
    expect(rows.map((r) => r.relname).sort()).toEqual(['api_tokens']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ชั้นที่ 2 — policy บล็อกจริงไหม
// ═══════════════════════════════════════════════════════════════════════════
describe('การอ่านข้ามtenant', () => {
  it('เห็นเฉพาะหน้าของ workspace ตัวเอง', async () => {
    const seen = await db.withTenant(ids.wsA, ids.userA, (s) => s.db.select().from(pages));

    expect(seen.map((p) => p.id)).toEqual([ids.pageA]);
  });

  it('ระบุ id ของหน้าใน workspace อื่นตรง ๆ ก็ยังไม่เห็น', async () => {
    // ⚠️ นี่คือความต่างจาก query filter ในโค้ด: ที่นั่นการ "รู้ id" บวกกับ
    //    query ที่เขียนเองสักเส้นที่ลืม filter = อ่านข้าม tenant ได้
    const seen = await db.withTenant(ids.wsA, ids.userA, (s) =>
      s.db.select().from(pages).where(eq(pages.id, ids.pageB)),
    );

    expect(seen).toHaveLength(0);
  });

  it('raw SQL ก็ถูกกรอง — ไม่ใช่แค่ query ที่ผ่าน Drizzle', async () => {
    // ของเดิม (EF global query filter) กรองเฉพาะ query ที่ผ่าน LINQ
    // raw SQL ทุกเส้นเป็นช่องรั่ว การย้ายมาที่ RLS ปิดช่องนั้นทั้งหมด
    const { rows } = await db.withTenant(ids.wsA, ids.userA, (s) =>
      s.client.query<{ id: string }>('SELECT id FROM pages'),
    );

    expect(rows.map((r) => r.id)).toEqual([ids.pageA]);
  });

  it('ไม่ตั้ง tenant = ไม่เห็นอะไรเลย (fail closed) ไม่ใช่เห็นทั้งหมด', async () => {
    const seen = await db.withoutTenant((s) => s.db.select().from(pages));

    expect(seen).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ชั้นที่ 3 — connection pool
//
//  ⚠️ กับดักหลักของทั้งงานนี้ ถ้าใช้ SET แทน SET LOCAL เทสสามข้อนี้จะพัง
//     และเป็นเทสชุดเดียวที่พัง — ที่เหลือผ่านหมด
// ═══════════════════════════════════════════════════════════════════════════
describe('ค่าไม่ติดค้างข้าม request (pool max = 1)', () => {
  it('ธุรกรรมถัดไปบน connection เดิมเห็นของ tenant ตัวเอง ไม่ใช่ของก่อนหน้า', async () => {
    const a = await db.withTenant(ids.wsA, ids.userA, (s) => s.db.select().from(pages));
    const b = await db.withTenant(ids.wsB, ids.userB, (s) => s.db.select().from(pages));

    expect(a.map((p) => p.id)).toEqual([ids.pageA]);
    expect(b.map((p) => p.id)).toEqual([ids.pageB]);
  });

  it('ธุรกรรมที่ไม่ตั้ง tenant หลังธุรกรรมที่ตั้ง ต้องไม่เห็นของที่ค้างไว้', async () => {
    await db.withTenant(ids.wsA, ids.userA, (s) => s.db.select().from(pages));

    const leaked = await db.withoutTenant((s) => s.db.select().from(pages));
    expect(leaked, 'app.workspace_id ติดค้างมากับ connection — ตรวจว่าใช้ set_config(…, true)').toHaveLength(0);
  });

  it('ค่า GUC หลุดขอบธุรกรรมจริง', async () => {
    await db.withTenant(ids.wsA, ids.userA, async (s) => {
      const { rows } = await s.client.query<{ v: string }>(`SELECT app_current_workspace()::text AS v`);
      expect(rows[0]?.v).toBe(ids.wsA);
    });

    const { rows } = await db.withoutTenant((s) =>
      s.client.query<{ v: string | null }>(`SELECT app_current_workspace()::text AS v`),
    );
    expect(rows[0]?.v).toBeNull();
  });

  it('หลัง COMMIT แล้วค่าไม่ค้างบน connection — ตรวจนอกขอบเขต withScope', async () => {
    // ⚠️ เทสข้อนี้คือข้อเดียวที่จับได้ว่าใช้ set_config(…, is_local = false)
    //
    //    ข้ออื่นจับไม่ได้เพราะ withScope เขียนทับค่าใหม่ทุกครั้งที่เปิดธุรกรรม
    //    (รวมทั้งเขียนทับด้วย '' ตอนไม่มี tenant) ซึ่งเป็นการป้องกันชั้นที่สอง
    //    ที่ตั้งใจใส่ไว้ — แต่มันก็กลบอาการของชั้นแรกไปพอดี
    //
    //    ถ้าชั้นแรกพัง ค่าจะค้างอยู่กับ connection หลัง release กลับ pool แล้ว
    //    query ใด ๆ ที่ไม่ผ่าน withScope จะทำงานในขอบเขตของ request ก่อนหน้า
    await db.withTenant(ids.wsA, ids.userA, (s) => s.db.select().from(pages));

    const { rows } = await db.unscopedPool.query<{ v: string | null }>(
      'SELECT app_current_workspace()::text AS v',
    );
    expect(rows[0]?.v, 'app.workspace_id ค้างอยู่กับ connection — ต้องเป็น set_config(…, true)').toBeNull();
  });

  it('ธุรกรรมที่ throw ไม่ทิ้ง tenant ค้างไว้บน connection', async () => {
    await expect(
      db.withTenant(ids.wsA, ids.userA, () => Promise.reject(new Error('พังกลางทาง'))),
    ).rejects.toThrow('พังกลางทาง');

    const leaked = await db.withoutTenant((s) => s.db.select().from(pages));
    expect(leaked).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ชั้นที่ 4 — ฝั่งเขียน
//
//  USING อย่างเดียวกัน "อ่าน" ข้าม tenant ไม่ได้ แต่ยัง "เขียน" ข้ามได้
//  WITH CHECK คือสิ่งที่ปิดทางนั้น
// ═══════════════════════════════════════════════════════════════════════════
describe('การเขียนข้ามtenant', () => {
  it('INSERT หน้าเข้า workspace อื่นถูกปฏิเสธ', async () => {
    await expect(
      db.withTenant(ids.wsA, ids.userA, (s) =>
        s.db.insert(pages).values({
          workspaceId: ids.wsB, // ← workspace ของคนอื่น
          rank: 'a1',
          kind: 'page',
          accessRootId: randomUUID(),
          title: 'ของปลอม',
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('UPDATE ย้ายหน้าไป workspace อื่นไม่ได้', async () => {
    await expect(
      db.withTenant(ids.wsA, ids.userA, (s) =>
        s.db.update(pages).set({ workspaceId: ids.wsB }).where(eq(pages.id, ids.pageA)),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('DELETE หน้าของ workspace อื่นไม่โดนอะไรเลย', async () => {
    await db.withTenant(ids.wsA, ids.userA, (s) => s.db.delete(pages).where(eq(pages.id, ids.pageB)));

    const { rows } = await admin.query('SELECT 1 FROM pages WHERE id = $1', [ids.pageB]);
    expect(rows).toHaveLength(1);
  });

  it('เขียนในขอบเขตตัวเองได้ตามปกติ', async () => {
    const id = randomUUID();
    await db.withTenant(ids.wsA, ids.userA, (s) =>
      s.db.insert(pages).values({
        id,
        workspaceId: ids.wsA,
        rank: 'a1',
        kind: 'page',
        accessRootId: id,
        title: 'หน้าใหม่',
      }),
    );

    const seen = await db.withTenant(ids.wsA, ids.userA, (s) => s.db.select().from(pages));
    expect(seen.map((p) => p.id).sort()).toEqual([ids.pageA, id].sort());

    await admin.query('DELETE FROM pages WHERE id = $1', [id]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ชั้นที่ 5 — flow ที่ต้องทำงานได้ทั้งที่ยังไม่มี tenant
//
//  ถ้าออกแบบ policy แบบ workspace_id = current เพียงอย่างเดียว สองข้อนี้จะ
//  ล็อกอินไม่ได้และสร้าง workspace ไม่ได้ — ซึ่งแปลว่าใช้ระบบไม่ได้เลย
// ═══════════════════════════════════════════════════════════════════════════
describe('ขอบเขตระดับ identity', () => {
  it('อ่าน "workspace ของฉัน" ได้โดยยังไม่ต้องเลือก workspace', async () => {
    const mine = await db.withIdentity(ids.userA, (s) => s.db.select().from(workspaces));

    expect(mine.map((w) => w.id)).toEqual([ids.wsA]);
  });

  it('เห็นเฉพาะ membership ของตัวเอง ไม่เห็นของคนอื่น', async () => {
    const mine = await db.withIdentity(ids.userA, (s) => s.db.select().from(workspaceMembers));

    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ workspaceId: ids.wsA, userId: ids.userA });
  });

  it('สร้าง workspace ใหม่แล้วเขียนสมาชิกต่อในธุรกรรมเดียวกันได้', async () => {
    const wsNew = randomUUID();

    await db.withIdentity(ids.userA, async (s) => {
      await s.db.insert(workspaces).values({
        id: wsNew,
        slug: slug(wsNew),
        name: 'workspace ใหม่',
        createdBy: ids.userA, // ← เงื่อนไขเดียวที่ policy ของ INSERT ยอมรับ
      });

      // ⚠️ ก่อนบรรทัดนี้ยังไม่มี tenant — INSERT สมาชิกจะถูกปฏิเสธ
      await s.enterWorkspace(wsNew);

      await s.db.insert(workspaceMembers).values({
        workspaceId: wsNew,
        userId: ids.userA,
        role: 'owner',
      });
    });

    const { rows } = await admin.query('SELECT 1 FROM workspace_members WHERE workspace_id = $1', [wsNew]);
    expect(rows).toHaveLength(1);

    await admin.query('DELETE FROM workspaces WHERE id = $1', [wsNew]);
  });

  it('สร้าง workspace ในนามคนอื่นไม่ได้', async () => {
    const wsNew = randomUUID();

    await expect(
      db.withIdentity(ids.userA, (s) =>
        s.db.insert(workspaces).values({
          id: wsNew,
          slug: slug(wsNew),
          name: 'สวมรอย',
          createdBy: ids.userB, // ← ไม่ใช่ฉัน
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('เขียนสมาชิกโดยไม่มี tenant ไม่ได้ แม้จะเป็น workspace ของตัวเอง', async () => {
    // ⚠️ ด้านอ่านของ workspace_members ผ่อนให้ (เห็นแถวของตัวเอง) แต่ด้านเขียน
    //    ไม่ผ่อน ไม่งั้นใครก็เติมตัวเองเข้า workspace ใครก็ได้
    await expect(
      db.withIdentity(ids.userA, (s) =>
        s.db.insert(workspaceMembers).values({
          workspaceId: ids.wsB,
          userId: ids.userA,
          role: 'owner',
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ชั้นที่ 6 — ธุรกรรมซ้อน
// ═══════════════════════════════════════════════════════════════════════════
describe('ธุรกรรมซ้อน', () => {
  it('withScope ซ้อนใน tenant เดียวกันใช้ connection เดิม ไม่ค้าง', async () => {
    // pool มี connection เดียว — ถ้าชั้นในเปิดใหม่ เทสนี้จะค้างจนหมดเวลา
    const seen = await db.withTenant(ids.wsA, ids.userA, () =>
      db.withTenant(ids.wsA, ids.userA, (inner) => inner.db.select().from(pages)),
    );

    expect(seen.map((p) => p.id)).toEqual([ids.pageA]);
  });

  it('ซ้อนด้วย tenant คนละอันถูกปฏิเสธตั้งแต่ในโค้ด', async () => {
    await expect(
      db.withTenant(ids.wsA, ids.userA, () =>
        db.withTenant(ids.wsB, ids.userB, () => Promise.resolve(null)),
      ),
    ).rejects.toThrow(/workspace คนละอัน/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ชั้นที่ 7 — ของที่ Drizzle เขียนไม่ได้ ยังอยู่ครบไหม
//
//  ไม่ใช่เรื่อง RLS แต่เป็นของที่ "ลืมแล้วเจ็บทีหลัง" และตรวจตอนนี้ได้ฟรี
// ═══════════════════════════════════════════════════════════════════════════
describe('SQL objects ที่ Drizzle เขียนไม่ได้', () => {
  it('pages.rank เป็น COLLATE "C"', async () => {
    // ⚠️ ถ้าเป็น collation ของเครื่อง (ICU th-TH) ลำดับหน้าที่ผู้ใช้เห็นจะไม่
    //    ตรงกับที่ generateKeyBetween คำนวณไว้ และอาการจะโผล่หลัง deploy
    const { rows } = await admin.query<{ collname: string }>(
      `SELECT co.collname
         FROM pg_attribute a
         JOIN pg_class c     ON c.oid = a.attrelid
         JOIN pg_collation co ON co.oid = a.attcollation
        WHERE c.relname = 'pages' AND a.attname = 'rank'`,
    );

    expect(rows[0]?.collname).toBe('C');
  });

  it('PGroonga index ทั้งสองตัวมี bigram tokenizer', async () => {
    // ค่า default ตัดคำด้วยช่องว่าง → ภาษาไทยทั้งประโยคเป็น token เดียว
    const { rows } = await admin.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'page_searches' AND indexdef LIKE '%pgroonga%'`,
    );

    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.indexdef, `${r.indexname} ขาด tokenizer`).toContain("TokenNgram(\"n\", 2");
    }
  });

  it('FK ของ activity_logs เป็น SET NULL เฉพาะ page_id', async () => {
    // ⚠️ SET NULL แบบไม่ระบุคอลัมน์จะ null workspace_id ที่เป็น NOT NULL ด้วย
    //    ทำให้ purge หน้าที่มีประวัติล้มทุกครั้ง = ลบถาวรไม่ได้เลย
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conname = 'fk_activity_logs_pages'`,
    );

    expect(rows[0]?.def).toMatch(/ON DELETE SET NULL \(page_id\)/i);
  });

  it('purge หน้าที่มีประวัติได้จริง และประวัติยังอ่านได้', async () => {
    // เทสข้อนี้คือเหตุผลที่ข้อบนมีอยู่ — ตรวจผลลัพธ์ ไม่ใช่แค่รูปของ constraint
    await admin.query(
      `INSERT INTO activity_logs (workspace_id, page_id, page_title, actor_user_id, action)
       VALUES ($1, $2, 'หน้าแรก', $3, 'page.deleted')`,
      [ids.wsA, ids.pageA, ids.userA],
    );

    await admin.query('DELETE FROM pages WHERE id = $1', [ids.pageA]);

    const { rows } = await admin.query<{ page_id: string | null; workspace_id: string; page_title: string }>(
      'SELECT page_id, workspace_id, page_title FROM activity_logs WHERE workspace_id = $1',
      [ids.wsA],
    );

    expect(rows[0]?.page_id).toBeNull();
    expect(rows[0]?.workspace_id).toBe(ids.wsA);
    expect(rows[0]?.page_title).toBe('หน้าแรก');

    // คืนหน้าให้เทสอื่นที่รันทีหลัง (vitest รันไฟล์เดียวตามลำดับ)
    await admin.query(
      `INSERT INTO pages (id, workspace_id, rank, kind, access_root_id, title)
       VALUES ($1, $2, 'a0', 'page', $1, 'หน้าแรก')`,
      [ids.pageA, ids.wsA],
    );
    await admin.query('DELETE FROM activity_logs WHERE workspace_id = $1', [ids.wsA]);
  });

  it('CHECK constraint กันค่าขยะแม้เขียนด้วยบัญชี owner', async () => {
    await expect(
      admin.query(
        `INSERT INTO pages (workspace_id, rank, kind, access_root_id) VALUES ($1, 'a0', 'ไม่มีชนิดนี้', $1)`,
        [ids.wsA],
      ),
    ).rejects.toThrow(/ck_pages_kind/);

    await expect(
      admin.query(`UPDATE pages SET depth = 5 WHERE id = $1`, [ids.pageA]),
    ).rejects.toThrow(/ck_pages_depth_matches_ancestors/);
  });
});
