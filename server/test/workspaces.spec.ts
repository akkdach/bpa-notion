// ═══════════════════════════════════════════════════════════════════════════
//  workspaces · members · search · activity · notes · health
//
//  ⚠️ ข้อที่สำคัญที่สุดในไฟล์นี้คือ "สร้าง workspace แรกได้ไหม" — มันคือ flow
//     เดียวที่ต้องเขียนข้ามขอบเขต RLS กลางธุรกรรม (ยังไม่มี tenant ตอนเริ่ม
//     แล้วมีตอนจบ) ถ้าพัง ระบบใช้งานไม่ได้เลยตั้งแต่ผู้ใช้คนแรก
// ═══════════════════════════════════════════════════════════════════════════

import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['DATABASE_POOL_MAX'] = '5';

const { AppModule } = await import('../src/app.module.js');
const { configureApp } = await import('../src/bootstrap.js');

interface Envelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
}

interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  role: string;
}

let baseUrl: string;
let close: () => Promise<void>;
let admin: pg.Client;

const createdUsers: string[] = [];
const createdWorkspaces: string[] = [];
const password = 'รหัสผ่านยาวพอสมควรนะ';

let owner: { token: string; userId: string; email: string };

beforeAll(async () => {
  admin = new pg.Client({ connectionString: process.env['DATABASE_ADMIN_URL'] });
  await admin.connect();

  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  configureApp(app);
  await app.listen(0);

  baseUrl = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');
  close = () => app.close();

  owner = await register();
}, 90_000);

afterAll(async () => {
  await close?.();
  if (createdWorkspaces.length > 0) {
    await admin.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [createdWorkspaces]);
  }
  if (createdUsers.length > 0) {
    await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUsers]);
  }
  await admin.end();
});

async function call<T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; workspace?: string } = {},
): Promise<{ status: number; body: Envelope<T> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  if (options.workspace) headers['x-workspace-id'] = options.workspace;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function register(): Promise<{ token: string; userId: string; email: string }> {
  const email = `t-${randomUUID()}@example.test`;
  const { body } = await call<{ accessToken: string; user: { id: string } }>('POST', '/auth/register', {
    body: { email, password, name: 'ผู้ทดสอบ' },
  });
  createdUsers.push(body.data!.user.id);
  return { token: body.data!.accessToken, userId: body.data!.user.id, email };
}

/** สร้าง workspace ผ่าน API จริง — ไม่ใช่ seed ด้วย SQL เหมือนเทสไฟล์อื่น */
async function createWorkspace(
  actor: { token: string },
  body: Record<string, unknown> = { name: 'ที่ทำงานของฉัน' },
): Promise<WorkspaceSummary> {
  const { status, body: envelope } = await call<WorkspaceSummary>('POST', '/workspaces', {
    token: actor.token,
    body,
  });

  expect(status, JSON.stringify(envelope)).toBe(201);
  createdWorkspaces.push(envelope.data!.id);
  return envelope.data!;
}

// ═══════════════════════════════════════════════════════════════════════════
//  สร้าง workspace — flow ที่ข้ามขอบเขต RLS กลางธุรกรรม
// ═══════════════════════════════════════════════════════════════════════════
describe('สร้าง workspace', () => {
  it('ผู้ใช้ใหม่สร้าง workspace แรกได้ และกลายเป็น owner ทันที', async () => {
    const user = await register();
    const ws = await createWorkspace(user, { name: 'ที่ทำงานแรก' });

    expect(ws.role).toBe('owner');

    // ต้องโผล่ในรายการของตัวเองทันที (อ่านผ่าน RLS policy ของ workspaces)
    const mine = await call<WorkspaceSummary[]>('GET', '/workspaces', { token: user.token });
    expect(mine.body.data!.map((w) => w.id)).toEqual([ws.id]);

    // และแถวสมาชิกต้องถูกเขียนจริง ไม่ใช่แค่แถว workspace
    const { rows } = await admin.query<{ role: string }>(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [ws.id, user.userId],
    );
    expect(rows[0]?.role).toBe('owner');
  });

  it('ชื่อไทยล้วน → slug อ่านออกและผ่าน CHECK constraint', async () => {
    // ⚠️ ck_workspaces_slug_format บังคับ ^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$
    //    ถ้า slug generator ปล่อยอักขระไทยผ่าน ฐานจะปฏิเสธเป็น 500
    const ws = await createWorkspace(owner, { name: 'ทีมพัฒนาผลิตภัณฑ์' });

    expect(ws.slug).toMatch(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/);
    expect(ws.name).toBe('ทีมพัฒนาผลิตภัณฑ์');
  });

  it('ชื่อภาษาอังกฤษ → slug มาจากชื่อ', async () => {
    const ws = await createWorkspace(owner, { name: '  Product   Team!! ' });
    expect(ws.slug).toBe('product-team');
  });

  it('slug ที่ระบุเองแล้วชน → 409 ไม่ใช่เปลี่ยนให้เงียบ ๆ', async () => {
    const first = await createWorkspace(owner, { name: 'ก', slug: `dup-${randomUUID().slice(0, 8)}` });

    const { status, body } = await call('POST', '/workspaces', {
      token: owner.token,
      body: { name: 'ข', slug: first.slug },
    });

    expect(status).toBe(409);
    expect(body.code).toBe('slug_taken');
  });

  it('slug ที่ระบบสร้างเองแล้วชน → เติมท้ายให้ ไม่ใช่ 409', async () => {
    // ⚠️ ธุรกรรมของทั้ง request เป็นก้อนเดียว การลอง INSERT ซ้ำหลังชน unique
    //    index ต้องอยู่ใน savepoint ไม่งั้นคำสั่งถัดไปตอบ "current transaction
    //    is aborted" แทนที่จะเป็นการชนซ้ำ
    const name = `Team ${randomUUID().slice(0, 8)}`;
    const first = await createWorkspace(owner, { name });
    const second = await createWorkspace(owner, { name });

    expect(second.slug).not.toBe(first.slug);
    expect(second.slug.startsWith(first.slug.slice(0, 10))).toBe(true);
    expect(second.slug).toMatch(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/);
  });

  it('slug ที่ระบุเองแต่ไม่มีตัวอักษรใช้ได้เลย → 400', async () => {
    const { status, body } = await call('POST', '/workspaces', {
      token: owner.token,
      body: { name: 'ก', slug: 'ไทยล้วน' },
    });

    expect(status).toBe(400);
    expect(body.code).toBe('invalid_slug');
  });

  it('ยังไม่ล็อกอิน → 401', async () => {
    expect((await call('POST', '/workspaces', { body: { name: 'x' } })).status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  สมาชิก
// ═══════════════════════════════════════════════════════════════════════════
describe('สมาชิก', () => {
  it('เพิ่มสมาชิกด้วยอีเมลของคนที่สมัครแล้ว', async () => {
    const ws = await createWorkspace(owner);
    const invitee = await register();

    const { status, body } = await call<{ userId: string; role: string }>(
      'POST',
      '/workspaces/current/members',
      { token: owner.token, workspace: ws.id, body: { email: invitee.email, role: 'member' } },
    );

    // ⚠️ 200 ไม่ใช่ 201 — สัญญาที่ client เดิมใช้อยู่ (ดู scripts/smoke-test.mjs)
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data!.userId).toBe(invitee.userId);

    const list = await call<{ userId: string }[]>('GET', '/workspaces/current/members', {
      token: owner.token,
      workspace: ws.id,
    });
    expect(list.body.data!.map((m) => m.userId).sort()).toEqual([owner.userId, invitee.userId].sort());
  });

  it('อีเมลที่ยังไม่สมัคร → 404 พร้อมบอกว่าต้องทำอะไร', async () => {
    // ระบบนี้ไม่มีการเชิญทางอีเมล (ไม่มี SMTP) ผู้ใช้ต้องสมัครเองก่อน
    const ws = await createWorkspace(owner);

    const { status, body } = await call('POST', '/workspaces/current/members', {
      token: owner.token,
      workspace: ws.id,
      body: { email: `ไม่มีจริง-${randomUUID()}@example.test`, role: 'member' },
    });

    expect(status).toBe(404);
    expect(body.code).toBe('user_not_registered');
  });

  it('เพิ่มคนเดิมซ้ำ → 409', async () => {
    const ws = await createWorkspace(owner);
    const invitee = await register();
    const body = { email: invitee.email, role: 'member' };

    await call('POST', '/workspaces/current/members', { token: owner.token, workspace: ws.id, body });
    const second = await call('POST', '/workspaces/current/members', {
      token: owner.token,
      workspace: ws.id,
      body,
    });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('already_member');
  });

  it('admin แต่งตั้ง owner ไม่ได้ — กันการยกระดับตัวเองทางอ้อม', async () => {
    const ws = await createWorkspace(owner);
    const adminUser = await register();
    const other = await register();

    await call('POST', '/workspaces/current/members', {
      token: owner.token,
      workspace: ws.id,
      body: { email: adminUser.email, role: 'admin' },
    });

    const { status, body } = await call('POST', '/workspaces/current/members', {
      token: adminUser.token,
      workspace: ws.id,
      body: { email: other.email, role: 'owner' },
    });

    expect(status).toBe(403);
    expect(body.code).toBe('insufficient_role');
  });

  it('ลดสิทธิ์ owner คนสุดท้ายไม่ได้ — กัน workspace กำพร้า', async () => {
    // ถ้าปล่อยผ่าน จะไม่เหลือใครที่แต่งตั้ง owner คนใหม่ได้อีกเลย
    const ws = await createWorkspace(owner);

    const { status, body } = await call('PATCH', `/workspaces/current/members/${owner.userId}`, {
      token: owner.token,
      workspace: ws.id,
      body: { role: 'member' },
    });

    expect(status).toBe(409);
    expect(body.code).toBe('last_owner');
  });

  it('owner คนสุดท้ายออกจาก workspace เองไม่ได้', async () => {
    const ws = await createWorkspace(owner);

    const { status, body } = await call('DELETE', `/workspaces/current/members/${owner.userId}`, {
      token: owner.token,
      workspace: ws.id,
    });

    expect(status).toBe(409);
    expect(body.code).toBe('last_owner');
  });

  it('สมาชิกธรรมดาออกเองได้ แต่ถอดคนอื่นไม่ได้', async () => {
    const ws = await createWorkspace(owner);
    const a = await register();
    const b = await register();

    for (const u of [a, b]) {
      await call('POST', '/workspaces/current/members', {
        token: owner.token,
        workspace: ws.id,
        body: { email: u.email, role: 'member' },
      });
    }

    const removeOther = await call('DELETE', `/workspaces/current/members/${b.userId}`, {
      token: a.token,
      workspace: ws.id,
    });
    expect(removeOther.status).toBe(403);

    const removeSelf = await call('DELETE', `/workspaces/current/members/${a.userId}`, {
      token: a.token,
      workspace: ws.id,
    });
    expect(removeSelf.status).toBe(200);

    // ออกแล้วเข้าไม่ได้อีก — 404 ไม่ใช่ 403
    const after = await call('GET', '/workspaces/current', { token: a.token, workspace: ws.id });
    expect(after.status).toBe(404);
  });

  it('ตั้งประเภทบัญชีเป็น agent ได้จาก endpoint เดียวกับ role', async () => {
    // ⚠️ "บัญชีนี้คือบอท" เป็นสิ่งที่ owner/admin ยืนยัน ไม่ใช่สิ่งที่บัญชีประกาศ
    //    เกี่ยวกับตัวเองตอนสมัคร
    const ws = await createWorkspace(owner);
    const bot = await register();

    await call('POST', '/workspaces/current/members', {
      token: owner.token,
      workspace: ws.id,
      body: { email: bot.email, role: 'member' },
    });

    const { status } = await call('PATCH', `/workspaces/current/members/${bot.userId}`, {
      token: owner.token,
      workspace: ws.id,
      body: { role: 'member', kind: 'agent' },
    });
    expect(status).toBe(200);

    const list = await call<{ userId: string; kind: string }[]>('GET', '/workspaces/current/members', {
      token: owner.token,
      workspace: ws.id,
    });
    expect(list.body.data!.find((m) => m.userId === bot.userId)?.kind).toBe('agent');
  });

  it('รายละเอียด workspace บอกจำนวนสมาชิกและสิทธิ์ของฉัน', async () => {
    const ws = await createWorkspace(owner, { name: 'ทีมเล็ก' });

    const { body } = await call<{ memberCount: number; myRole: string; name: string }>(
      'GET',
      '/workspaces/current',
      { token: owner.token, workspace: ws.id },
    );

    expect(body.data!.memberCount).toBe(1);
    expect(body.data!.myRole).toBe('owner');
    expect(body.data!.name).toBe('ทีมเล็ก');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ค้นหา
// ═══════════════════════════════════════════════════════════════════════════
describe('ค้นหา', () => {
  /** สร้างหน้าพร้อมเนื้อหาที่ค้นได้ */
  async function seedPage(ws: string, token: string, title: string, markdown: string) {
    const { body } = await call<{ id: string }>('POST', '/pages', {
      token,
      workspace: ws,
      body: { title },
    });
    const pageId = body.data!.id;

    await call('POST', `/pages/${pageId}/content/markdown`, {
      token,
      workspace: ws,
      body: { markdown },
    });

    return pageId;
  }

  it('ค้นคำไทยที่อยู่กลางประโยคเจอ — bigram tokenizer ทำงานจริง', async () => {
    // ⚠️ นี่คือเหตุผลทั้งหมดที่ index ต้องระบุ tokenizer เอง ค่า default ตัดคำ
    //    ด้วยช่องว่าง ภาษาไทยไม่มีช่องว่าง ทั้งประโยคจึงเป็น token เดียว
    const ws = await createWorkspace(owner);
    const pageId = await seedPage(ws.id, owner.token, 'เมนูอาหาร', 'วันนี้กินข้าวผัดกระเพราไก่ไข่ดาว');

    for (const q of ['ข้าวผัด', 'กระเพรา', 'ไก่ไข่']) {
      const { body } = await call<{ hits: { id: string }[] }>(
        'GET',
        `/search?q=${encodeURIComponent(q)}`,
        { token: owner.token, workspace: ws.id },
      );
      expect(body.data!.hits.map((h) => h.id), `ค้น "${q}" ไม่เจอ`).toContain(pageId);
    }
  });

  it('คำค้นสั้นเกินไป → 400 ไม่ใช่คืนทุกอย่าง', async () => {
    const ws = await createWorkspace(owner);
    const { status, body } = await call('GET', '/search?q=ก', { token: owner.token, workspace: ws.id });

    expect(status).toBe(400);
    expect(body.code).toBe('query_too_short');
  });

  it('อักขระพิเศษของ Groonga ไม่ทำให้ query พัง', async () => {
    // ⚠️ ถ้าไม่ escape ผู้ใช้พิมพ์วงเล็บเดียวก็ทำให้ทั้งคำขอ throw — และ AI ที่
    //    ได้ error กลับไปมักลองซ้ำแบบเดิม
    //
    // ⚠️ ต้องมีหน้าที่ค้นได้อย่างน้อยหนึ่งหน้า ไม่งั้น service คืนผลว่างตั้งแต่
    //    ก่อนยิง query แล้วเทสนี้จะ "ผ่าน" โดยไม่เคยแตะ PGroonga เลย
    //    (mutation test จับข้อนี้ได้ — ถอด escape ออกแล้วเทสยังเขียว)
    const ws = await createWorkspace(owner);
    const pageId = await seedPage(ws.id, owner.token, 'สัตว์ทะเล', 'แมวน้ำอยู่ในทะเลลึก');

    const search = async (q: string) =>
      call<{ hits: { id: string }[] }>('GET', `/search?q=${encodeURIComponent(q)}`, {
        token: owner.token,
        workspace: ws.id,
      });

    // ─────────────────────────────────────────────────────────────────
    //  ⚠️ "ไม่ 500" อย่างเดียวพิสูจน์ไม่พอ — mutation test แสดงว่าถอด escape
    //     ออกแล้วเทสแบบนั้นยังเขียวทั้งชุด
    //
    //     ต้องวัดที่ "ความหมาย": คำค้นของผู้ใช้ต้องถูกอ่านเป็นข้อความ ไม่ใช่
    //     ไวยากรณ์ของ Groonga  `(แมวน้ำ)` และ `+แมวน้ำ` จึงต้องหาไม่เจอ
    //     ทั้งที่หน้ามีคำว่า "แมวน้ำ" อยู่ — เพราะวงเล็บกับบวกเป็นตัวอักษรจริง
    //     ที่ผู้ใช้พิมพ์ ไม่ใช่ตัวดำเนินการ
    // ─────────────────────────────────────────────────────────────────
    expect((await search('แมวน้ำ')).body.data!.hits.map((h) => h.id)).toContain(pageId);

    for (const q of ['(แมวน้ำ)', '+แมวน้ำ']) {
      const { status, body } = await search(q);
      expect(status).toBe(200);
      expect(body.data!.hits.map((h) => h.id), `"${q}" ถูกอ่านเป็นไวยากรณ์ ไม่ใช่ข้อความ`).not.toContain(
        pageId,
      );
    }

    // และคำค้นที่ผิดรูปตามไวยากรณ์ Groonga ต้องไม่ทำให้ทั้งคำขอพัง
    for (const q of ['((', 'a OR', '+"', 'test*(', 'ก) OR (ข']) {
      expect((await search(q)).status, `คำค้น "${q}" ทำให้พัง`).toBe(200);
    }
  });

  it('หน้าที่ถูกลบไม่โผล่ในผลค้นหา', async () => {
    // ⚠️ ลบ "หน้าลูก" ไม่ใช่หน้าราก — access root ยังเป็นหน้าแม่ซึ่งยังมองเห็นได้
    //    ถ้าลบหน้าราก มันจะหลุดจาก visibleRoots ไปตั้งแต่ก่อนถึง SQL แล้วเงื่อนไข
    //    deleted_at ในคิวรีจะไม่ถูกทดสอบเลย
    const ws = await createWorkspace(owner);
    const parent = await seedPage(ws.id, owner.token, 'หน้าแม่', 'เนื้อหาของแม่');

    const { body: childBody } = await call<{ id: string }>('POST', '/pages', {
      token: owner.token,
      workspace: ws.id,
      body: { parentId: parent, title: 'หน้าลูกที่จะถูกลบ' },
    });
    const child = childBody.data!.id;

    await call('POST', `/pages/${child}/content/markdown`, {
      token: owner.token,
      workspace: ws.id,
      body: { markdown: 'คำเฉพาะมากคือซุปหน่อไม้' },
    });

    const before = await call<{ hits: { id: string }[] }>('GET', '/search?q=ซุปหน่อไม้', {
      token: owner.token,
      workspace: ws.id,
    });
    expect(before.body.data!.hits.map((h) => h.id), 'ยังไม่ลบก็ต้องค้นเจอ').toContain(child);

    await call('DELETE', `/pages/${child}`, { token: owner.token, workspace: ws.id });

    const after = await call<{ hits: { id: string }[] }>('GET', '/search?q=ซุปหน่อไม้', {
      token: owner.token,
      workspace: ws.id,
    });
    expect(after.body.data!.hits.map((h) => h.id)).not.toContain(child);
  });

  it('หน้าที่ไม่มีสิทธิ์เห็นไม่โผล่ในผลค้นหา', async () => {
    const ws = await createWorkspace(owner);
    const reader = await register();
    await call('POST', '/workspaces/current/members', {
      token: owner.token,
      workspace: ws.id,
      body: { email: reader.email, role: 'member' },
    });

    // ⚠️ reader ต้องมีหน้าที่เห็นได้อย่างน้อยหนึ่งหน้า ไม่งั้น visibleRoots ว่าง
    //    แล้ว service คืนผลว่างก่อนถึง SQL — เงื่อนไข access_root_id ในคิวรีจะไม่
    //    ถูกทดสอบเลย (mutation test จับข้อนี้ได้)
    await seedPage(ws.id, owner.token, 'หน้าเปิด', 'คำเฉพาะคือมะละกอสับที่ทุกคนเห็น');

    const secret = await seedPage(ws.id, owner.token, 'แผนลับ', 'รหัสลับคือมะละกอสับของเจ้าของ');
    await admin.query('DELETE FROM page_acls WHERE page_id = $1', [secret]);
    await admin.query(
      `INSERT INTO page_acls (page_id, workspace_id, subject_type, subject_id, role)
       VALUES ($1, $2, 'user', $3, 'editor')`,
      [secret, ws.id, owner.userId],
    );

    const asOwner = await call<{ hits: { id: string }[] }>('GET', '/search?q=มะละกอสับ', {
      token: owner.token,
      workspace: ws.id,
    });
    const asReader = await call<{ hits: { id: string }[] }>('GET', '/search?q=มะละกอสับ', {
      token: reader.token,
      workspace: ws.id,
    });

    expect(asOwner.body.data!.hits.map((h) => h.id)).toContain(secret);
    // reader เห็นหน้าเปิด แต่ไม่เห็นหน้าลับ — พิสูจน์ว่าคิวรีวิ่งจริงแล้วถูกกรอง
    expect(asReader.body.data!.hits.length).toBeGreaterThan(0);
    expect(asReader.body.data!.hits.map((h) => h.id)).not.toContain(secret);
  });

  it('หน้าของ workspace อื่นไม่โผล่ แม้คำค้นตรงเป๊ะ', async () => {
    const wsA = await createWorkspace(owner);
    const wsB = await createWorkspace(owner);

    const inA = await seedPage(wsA.id, owner.token, 'ของ A', 'คำที่ใช้ทดสอบคือแตงโมปลาแห้ง');

    const { body } = await call<{ hits: { id: string }[] }>('GET', '/search?q=แตงโมปลาแห้ง', {
      token: owner.token,
      workspace: wsB.id,
    });
    expect(body.data!.hits.map((h) => h.id)).not.toContain(inA);
  });

  it('กรองตามสถานะได้ และสถานะที่ไม่รู้จัก → 400', async () => {
    const ws = await createWorkspace(owner);
    const { body: created } = await call<{ id: string }>('POST', '/pages', {
      token: owner.token,
      workspace: ws.id,
      body: { title: 'งานที่ทำอยู่', status: 'doing' },
    });
    await call('POST', `/pages/${created.data!.id}/content/markdown`, {
      token: owner.token,
      workspace: ws.id,
      body: { markdown: 'คำเฉพาะคือลอดช่องสิงคโปร์' },
    });

    const doing = await call<{ hits: { id: string }[] }>(
      'GET',
      '/search?q=ลอดช่องสิงคโปร์&status=doing',
      { token: owner.token, workspace: ws.id },
    );
    expect(doing.body.data!.hits.map((h) => h.id)).toContain(created.data!.id);

    const done = await call<{ hits: { id: string }[] }>(
      'GET',
      '/search?q=ลอดช่องสิงคโปร์&status=done',
      { token: owner.token, workspace: ws.id },
    );
    expect(done.body.data!.hits).toHaveLength(0);

    const bad = await call('GET', '/search?q=ลอดช่อง&status=กำลังคิด', {
      token: owner.token,
      workspace: ws.id,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_status');
  });

  it('บอกตรง ๆ เมื่อผลถูกตัดที่ limit', async () => {
    // ⚠️ การตัดผลลัพธ์เงียบ ๆ ทำให้ผู้เรียก (โดยเฉพาะ AI) สรุปว่า "ค้นแล้วเจอ
    //    เท่านี้" ทั้งที่ยังมีอีก
    const ws = await createWorkspace(owner);
    for (let i = 0; i < 3; i++) {
      await seedPage(ws.id, owner.token, `หน้า ${i}`, 'คำซ้ำคือกล้วยแขกทอด');
    }

    const { body } = await call<{ count: number; truncated: boolean }>(
      'GET',
      '/search?q=กล้วยแขกทอด&limit=2',
      { token: owner.token, workspace: ws.id },
    );

    expect(body.data!.count).toBe(2);
    expect(body.data!.truncated).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  บันทึก + ฟีดกิจกรรม
// ═══════════════════════════════════════════════════════════════════════════
describe('บันทึกและฟีดกิจกรรม', () => {
  async function newPage(ws: string, title = 'หน้างาน') {
    const { body } = await call<{ id: string }>('POST', '/pages', {
      token: owner.token,
      workspace: ws,
      body: { title },
    });
    return body.data!.id;
  }

  it('เขียนบันทึกแล้วโผล่ทั้งในรายการและในฟีด', async () => {
    const ws = await createWorkspace(owner);
    const pageId = await newPage(ws.id);

    const { status, body } = await call<{ id: string; body: string }>(
      'POST',
      `/pages/${pageId}/notes`,
      { token: owner.token, workspace: ws.id, body: { body: 'ทำข้อหนึ่งเสร็จแล้ว' } },
    );

    expect(status, JSON.stringify(body)).toBe(201);

    const notes = await call<{ body: string }[]>('GET', `/pages/${pageId}/notes`, {
      token: owner.token,
      workspace: ws.id,
    });
    expect(notes.body.data!.map((n) => n.body)).toEqual(['ทำข้อหนึ่งเสร็จแล้ว']);

    const feed = await call<{ items: { action: string; detail: { preview?: string } }[] }>(
      'GET',
      `/activity?pageId=${pageId}`,
      { token: owner.token, workspace: ws.id },
    );
    const added = feed.body.data!.items.find((i) => i.action === 'note_added');
    expect(added?.detail.preview).toBe('ทำข้อหนึ่งเสร็จแล้ว');
  });

  it('commenter เขียนบันทึกได้ แต่แก้เนื้อหาไม่ได้', async () => {
    // ⚠️ นี่คือจุดแรกในระบบที่ commenter ต่างจาก viewer จริง ๆ
    const ws = await createWorkspace(owner);
    const reviewer = await register();
    await call('POST', '/workspaces/current/members', {
      token: owner.token,
      workspace: ws.id,
      body: { email: reviewer.email, role: 'member' },
    });

    const pageId = await newPage(ws.id);
    await admin.query(`UPDATE page_acls SET role = 'commenter' WHERE page_id = $1`, [pageId]);

    const note = await call('POST', `/pages/${pageId}/notes`, {
      token: reviewer.token,
      workspace: ws.id,
      body: { body: 'ขอให้แก้ย่อหน้าที่สอง' },
    });
    expect(note.status, JSON.stringify(note.body)).toBe(201);

    const edit = await call('PATCH', `/pages/${pageId}`, {
      token: reviewer.token,
      workspace: ws.id,
      body: { title: 'แก้ไม่ได้' },
    });
    expect(edit.status).toBe(403);
  });

  it('viewer อ่านบันทึกได้แต่เขียนไม่ได้', async () => {
    const ws = await createWorkspace(owner);
    const viewer = await register();
    await call('POST', '/workspaces/current/members', {
      token: owner.token,
      workspace: ws.id,
      body: { email: viewer.email, role: 'member' },
    });

    const pageId = await newPage(ws.id);
    await call('POST', `/pages/${pageId}/notes`, {
      token: owner.token,
      workspace: ws.id,
      body: { body: 'บันทึกของเจ้าของ' },
    });
    await admin.query(`UPDATE page_acls SET role = 'viewer' WHERE page_id = $1`, [pageId]);

    const read = await call<unknown[]>('GET', `/pages/${pageId}/notes`, {
      token: viewer.token,
      workspace: ws.id,
    });
    expect(read.status).toBe(200);
    expect(read.body.data).toHaveLength(1);

    const write = await call('POST', `/pages/${pageId}/notes`, {
      token: viewer.token,
      workspace: ws.id,
      body: { body: 'ไม่ควรเขียนได้' },
    });
    expect(write.status).toBe(403);
  });

  it('ฟีดบันทึกการกระทำครบตามที่เกิดจริง', async () => {
    const ws = await createWorkspace(owner);
    const pageId = await newPage(ws.id, 'ชื่อแรก');

    await call('PATCH', `/pages/${pageId}`, {
      token: owner.token,
      workspace: ws.id,
      body: { title: 'ชื่อที่สอง' },
    });
    await call('PATCH', `/pages/${pageId}`, {
      token: owner.token,
      workspace: ws.id,
      body: { status: 'done' },
    });
    await call('DELETE', `/pages/${pageId}`, { token: owner.token, workspace: ws.id });

    const { body } = await call<{ items: { action: string }[] }>('GET', `/activity?pageId=${pageId}`, {
      token: owner.token,
      workspace: ws.id,
    });

    expect(body.data!.items.map((i) => i.action)).toEqual([
      'page_deleted',
      'status_changed',
      'page_renamed',
      'page_created',
    ]);
  });

  it('กรองฟีดตามประเภทผู้ทำได้ และค่าที่ไม่รู้จัก → 400', async () => {
    const ws = await createWorkspace(owner);
    await newPage(ws.id);

    const human = await call<{ items: unknown[] }>('GET', '/activity?actorKind=human', {
      token: owner.token,
      workspace: ws.id,
    });
    expect(human.status).toBe(200);
    expect(human.body.data!.items.length).toBeGreaterThan(0);

    const agent = await call<{ items: unknown[] }>('GET', '/activity?actorKind=agent', {
      token: owner.token,
      workspace: ws.id,
    });
    expect(agent.body.data!.items).toHaveLength(0);

    const bad = await call('GET', '/activity?actorKind=หุ่นยนต์', {
      token: owner.token,
      workspace: ws.id,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_user_kind');
  });

  it('ฟีดของสมาชิกไม่โชว์หน้าที่ตัวเองไม่มีสิทธิ์เห็น', async () => {
    const ws = await createWorkspace(owner);
    const member = await register();
    await call('POST', '/workspaces/current/members', {
      token: owner.token,
      workspace: ws.id,
      body: { email: member.email, role: 'member' },
    });

    const secret = await newPage(ws.id, 'หน้าลับ');
    await admin.query('DELETE FROM page_acls WHERE page_id = $1', [secret]);
    await admin.query(
      `INSERT INTO page_acls (page_id, workspace_id, subject_type, subject_id, role)
       VALUES ($1, $2, 'user', $3, 'editor')`,
      [secret, ws.id, owner.userId],
    );

    const feed = await call<{ items: { pageId: string | null }[] }>('GET', '/activity', {
      token: member.token,
      workspace: ws.id,
    });

    expect(feed.body.data!.items.map((i) => i.pageId)).not.toContain(secret);
  });

  it('ประวัติของหน้าที่ถูกลบถาวรยังอ่านได้จากฟีดรวม', async () => {
    const ws = await createWorkspace(owner);
    const pageId = await newPage(ws.id, 'หน้าที่จะหายไป');

    await call('DELETE', `/pages/${pageId}`, { token: owner.token, workspace: ws.id });
    await call('DELETE', `/pages/${pageId}/purge`, { token: owner.token, workspace: ws.id });

    const { body } = await call<{ items: { pageId: string | null; pageTitle: string }[] }>(
      'GET',
      '/activity',
      { token: owner.token, workspace: ws.id },
    );

    const orphans = body.data!.items.filter((i) => i.pageTitle === 'หน้าที่จะหายไป');
    expect(orphans.length).toBeGreaterThan(0);
    expect(orphans.every((i) => i.pageId === null)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  health
// ═══════════════════════════════════════════════════════════════════════════
describe('health', () => {
  it('ไม่ต้องล็อกอิน และรายงาน extension ที่ต้องมีครบ', async () => {
    // ⚠️ ตรวจ pgroonga ด้วยเพราะถ้ามีคนสลับ image กลับไปเป็น postgres ธรรมดา
    //    ระบบจะต่อฐานได้ปกติแต่การค้นหาพังเงียบ ๆ
    const { status, body } = await call<{
      status: string;
      database: { canConnect: boolean; extensions: string[]; missingExtensions: string[] };
    }>('GET', '/health');

    expect(status).toBe(200);
    expect(body.data!.status).toBe('healthy');
    expect(body.data!.database.canConnect).toBe(true);
    expect(body.data!.database.extensions.sort()).toEqual(['citext', 'pgcrypto', 'pgroonga']);
    expect(body.data!.database.missingExtensions).toHaveLength(0);
  });
});
