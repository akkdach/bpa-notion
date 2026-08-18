// ═══════════════════════════════════════════════════════════════════════════
//  pages — tree · fractional index · move/trash/restore/purge · ACL
//
//  ⚠️ สิ่งที่ต้องพิสูจน์จริง ๆ คือค่าที่ denormalise ไว้สามตัวยังตรงกันหลังทุก
//     operation: ancestor_ids · depth · access_root_id
//
//     สองตัวแรกมี CHECK constraint คุมอยู่ (ck_pages_depth_matches_ancestors)
//     ตัวที่สามไม่มีอะไรคุมเลย และถ้าเพี้ยนมันคือบั๊กเรื่องสิทธิ์ — เทสชุดนี้จึง
//     เรียก /maintenance/consistency ปิดท้ายทุกกลุ่ม แทนที่จะเช็คทีละ field
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

interface PageDto {
  id: string;
  parentId: string | null;
  ancestorIds: string[];
  depth: number;
  rank: string;
  title: string;
  icon: string | null;
  status: string | null;
  accessRootId: string;
  myRole: string;
  deletedAt: string | null;
}

interface PageNodeDto {
  id: string;
  parentId: string | null;
  title: string;
  depth: number;
  rank: string;
  hasChildren: boolean;
}

interface Consistency {
  badAncestors: number;
  badAccessRoots: number;
  orphans: number;
}

let baseUrl: string;
let close: () => Promise<void>;
let admin: pg.Client;

const createdUsers: string[] = [];
const createdWorkspaces: string[] = [];
const password = 'รหัสผ่านยาวพอสมควรนะ';

/** owner ของ workspace หลักที่เทสส่วนใหญ่ใช้ */
let owner: { token: string; userId: string };
let ws: string;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: process.env['DATABASE_ADMIN_URL'] });
  await admin.connect();

  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  configureApp(app);
  await app.listen(0);

  baseUrl = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');
  close = () => app.close();

  owner = await register();
  ws = await seedWorkspace(owner.userId, 'owner');
}, 60_000);

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

// ─────────────────────────────────────────────────────────────────────────
//  helpers
// ─────────────────────────────────────────────────────────────────────────

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

async function register(): Promise<{ token: string; userId: string }> {
  const { status, body } = await call<{ accessToken: string; user: { id: string } }>(
    'POST',
    '/auth/register',
    { body: { email: `t-${randomUUID()}@example.test`, password, name: 'ผู้ทดสอบ' } },
  );

  expect(status, JSON.stringify(body)).toBe(200);
  createdUsers.push(body.data!.user.id);
  return { token: body.data!.accessToken, userId: body.data!.user.id };
}

async function seedWorkspace(userId: string, role: string): Promise<string> {
  const id = randomUUID();
  await admin.query('INSERT INTO workspaces (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [
    id,
    `t-${id.slice(0, 8)}`,
    'workspace ทดสอบ',
    userId,
  ]);
  await admin.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [
    id,
    userId,
    role,
  ]);
  createdWorkspaces.push(id);
  return id;
}

async function join(workspaceId: string, userId: string, role: string): Promise<void> {
  await admin.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [
    workspaceId,
    userId,
    role,
  ]);
}

/** สร้างหน้าแล้วคาดว่าสำเร็จ */
async function createPage(
  actor: { token: string },
  workspace: string,
  body: Record<string, unknown> = {},
): Promise<PageDto> {
  const { status, body: envelope } = await call<PageDto>('POST', '/pages', {
    token: actor.token,
    workspace,
    body,
  });

  expect(status, JSON.stringify(envelope)).toBe(201);
  return envelope.data!;
}

async function consistency(workspace = ws): Promise<Consistency> {
  const { status, body } = await call<Consistency>('GET', '/pages/maintenance/consistency', {
    token: owner.token,
    workspace,
  });

  expect(status, JSON.stringify(body)).toBe(200);
  return body.data!;
}

const CLEAN: Consistency = { badAncestors: 0, badAccessRoots: 0, orphans: 0 };

// ═══════════════════════════════════════════════════════════════════════════
//  สร้าง
// ═══════════════════════════════════════════════════════════════════════════
describe('สร้างหน้า', () => {
  it('หน้าระดับบนสุดเป็น access root ของตัวเอง และมี ACL ทันที', async () => {
    // ⚠️ ถ้าไม่มี ACL หน้านั้นจะเป็น access root ที่ไม่มี grant = ไม่มีใครเห็นเลย
    //    รวมทั้งคนสร้าง (owner/admin ยังเห็นเพราะ short-circuit แต่ member ไม่เห็น)
    const page = await createPage(owner, ws, { title: 'หน้าแรก' });

    expect(page.parentId).toBeNull();
    expect(page.depth).toBe(0);
    expect(page.ancestorIds).toEqual([]);
    expect(page.accessRootId).toBe(page.id);
    expect(page.myRole).toBe('full');

    const { rows } = await admin.query('SELECT subject_type, role FROM page_acls WHERE page_id = $1', [
      page.id,
    ]);
    expect(rows).toEqual([{ subject_type: 'workspace', role: 'editor' }]);
  });

  it('หน้าลูกสืบทอด access root จากพ่อ และ depth/ancestors ถูกต้อง', async () => {
    const root = await createPage(owner, ws, { title: 'ราก' });
    const child = await createPage(owner, ws, { parentId: root.id, title: 'ลูก' });
    const grandchild = await createPage(owner, ws, { parentId: child.id, title: 'หลาน' });

    expect(child.depth).toBe(1);
    expect(child.ancestorIds).toEqual([root.id]);
    expect(child.accessRootId).toBe(root.id);

    expect(grandchild.depth).toBe(2);
    expect(grandchild.ancestorIds).toEqual([root.id, child.id]);
    expect(grandchild.accessRootId).toBe(root.id);

    // หน้าลูกไม่มี ACL ของตัวเอง — สืบทอดอย่างเดียว
    const { rows } = await admin.query('SELECT 1 FROM page_acls WHERE page_id = $1', [child.id]);
    expect(rows).toHaveLength(0);
  });

  it('แถวใน page_searches เกิดพร้อมหน้า ไม่รอเบราว์เซอร์', async () => {
    // ⚠️ ก่อนหน้านี้แถวนี้เกิดเมื่อเบราว์เซอร์ POST /projection เท่านั้น แปลว่า
    //    หน้าที่ AI สร้างและยังไม่มีใครเปิดจะ "ไม่มีแถวเลย" — ค้นหาไม่เจอผลงาน
    //    ของ AI เองตลอดไป
    const page = await createPage(owner, ws, { title: 'ค้นหาเจอไหม' });

    const { rows } = await admin.query<{ title: string; access_root_id: string }>(
      'SELECT title, access_root_id FROM page_searches WHERE page_id = $1',
      [page.id],
    );

    expect(rows[0]?.title).toBe('ค้นหาเจอไหม');
    expect(rows[0]?.access_root_id).toBe(page.accessRootId);
  });

  it('สร้างพร้อมสถานะได้ใน request เดียว', async () => {
    const page = await createPage(owner, ws, { title: 'งาน', status: 'doing' });
    expect(page.status).toBe('doing');
  });

  it('สถานะที่ไม่รู้จัก → 400 ไม่ใช่ 500 จาก CHECK constraint', async () => {
    const { status, body } = await call('POST', '/pages', {
      token: owner.token,
      workspace: ws,
      body: { title: 'x', status: 'กำลังคิดอยู่' },
    });

    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
  });

  it('พี่น้องเรียงตาม rank และ rank ใหม่ต่อท้ายเสมอ', async () => {
    const parent = await createPage(owner, ws, { title: 'พ่อ' });
    const a = await createPage(owner, ws, { parentId: parent.id, title: 'ก' });
    const b = await createPage(owner, ws, { parentId: parent.id, title: 'ข' });
    const c = await createPage(owner, ws, { parentId: parent.id, title: 'ค' });

    expect(a.rank < b.rank).toBe(true);
    expect(b.rank < c.rank).toBe(true);

    // แทรกระหว่าง a กับ b
    const between = await createPage(owner, ws, {
      parentId: parent.id,
      title: 'ก.5',
      afterPageId: a.id,
    });

    expect(a.rank < between.rank).toBe(true);
    expect(between.rank < b.rank).toBe(true);
  });

  it('ค่าที่ denormalise ไว้ยังตรงกันหลังสร้างหลายชั้น', async () => {
    expect(await consistency()).toEqual(CLEAN);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ย้าย
// ═══════════════════════════════════════════════════════════════════════════
describe('ย้ายหน้า', () => {
  it('ย้าย subtree แล้วลูกหลานได้ ancestors/depth ใหม่ใน UPDATE เดียว', async () => {
    const oldParent = await createPage(owner, ws, { title: 'พ่อเดิม' });
    const newParent = await createPage(owner, ws, { title: 'พ่อใหม่' });
    const moving = await createPage(owner, ws, { parentId: oldParent.id, title: 'ตัวที่ย้าย' });
    const child = await createPage(owner, ws, { parentId: moving.id, title: 'ลูก' });
    const grandchild = await createPage(owner, ws, { parentId: child.id, title: 'หลาน' });

    const { status, body } = await call<{ page: PageDto; affectedDescendants: number }>(
      'POST',
      `/pages/${moving.id}/move`,
      { token: owner.token, workspace: ws, body: { parentId: newParent.id } },
    );

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data!.affectedDescendants).toBe(2);
    expect(body.data!.page.ancestorIds).toEqual([newParent.id]);
    expect(body.data!.page.depth).toBe(1);

    const after = await call<PageDto>('GET', `/pages/${grandchild.id}`, {
      token: owner.token,
      workspace: ws,
    });

    expect(after.body.data!.ancestorIds).toEqual([newParent.id, moving.id, child.id]);
    expect(after.body.data!.depth).toBe(3);
    // access root ตามพ่อใหม่ไปด้วย เพราะ subtree นี้ไม่มี ACL ของตัวเอง
    expect(after.body.data!.accessRootId).toBe(newParent.id);

    expect(await consistency()).toEqual(CLEAN);
  });

  it('ย้ายไปใต้ตัวเอง → 400 cycle', async () => {
    const page = await createPage(owner, ws, { title: 'ตัวเอง' });

    const { status, body } = await call('POST', `/pages/${page.id}/move`, {
      token: owner.token,
      workspace: ws,
      body: { parentId: page.id },
    });

    expect(status).toBe(400);
    expect(body.code).toBe('cycle');
  });

  it('ย้ายไปใต้ลูกหลานของตัวเอง → 400 cycle', async () => {
    // ⚠️ ถ้าปล่อยผ่าน จะได้ subtree ที่หลุดออกจาก tree (parent ชี้กันเป็นวง)
    //    แล้ว recursive CTE ตอนซ่อมจะวนไม่จบ
    const root = await createPage(owner, ws, { title: 'ราก' });
    const child = await createPage(owner, ws, { parentId: root.id, title: 'ลูก' });
    const grandchild = await createPage(owner, ws, { parentId: child.id, title: 'หลาน' });

    const { status, body } = await call('POST', `/pages/${root.id}/move`, {
      token: owner.token,
      workspace: ws,
      body: { parentId: grandchild.id },
    });

    expect(status).toBe(400);
    expect(body.code).toBe('cycle');
  });

  it('ย้ายขึ้นระดับบนสุดแล้วได้ ACL ของตัวเอง', async () => {
    // ไม่งั้นจะกลายเป็น access root ที่ไม่มี grant = หายไปจากสายตาทุกคน
    const parent = await createPage(owner, ws, { title: 'พ่อ' });
    const child = await createPage(owner, ws, { parentId: parent.id, title: 'ลูกที่จะย้ายขึ้น' });

    const { status } = await call('POST', `/pages/${child.id}/move`, {
      token: owner.token,
      workspace: ws,
      body: { parentId: null },
    });
    expect(status).toBe(200);

    const { rows } = await admin.query('SELECT subject_type, role FROM page_acls WHERE page_id = $1', [
      child.id,
    ]);
    expect(rows).toEqual([{ subject_type: 'workspace', role: 'editor' }]);

    const after = await call<PageDto>('GET', `/pages/${child.id}`, { token: owner.token, workspace: ws });
    expect(after.body.data!.accessRootId).toBe(child.id);
    expect(await consistency()).toEqual(CLEAN);
  });

  it('หน้าที่มี ACL ของตัวเองยังเป็น access root เดิมหลังย้าย', async () => {
    const a = await createPage(owner, ws, { title: 'ก' });
    const b = await createPage(owner, ws, { title: 'ข' });
    const child = await createPage(owner, ws, { parentId: a.id, title: 'ลูกของ ก' });

    // ให้ child มี ACL ของตัวเอง → มันเป็น access root ของตัวเอง
    await admin.query(
      `INSERT INTO page_acls (page_id, workspace_id, subject_type, subject_id, role)
       VALUES ($1, $2, 'workspace', '00000000-0000-0000-0000-000000000000', 'editor')`,
      [child.id, ws],
    );
    await call('POST', '/pages/maintenance/repair', { token: owner.token, workspace: ws });

    await call('POST', `/pages/${child.id}/move`, {
      token: owner.token,
      workspace: ws,
      body: { parentId: b.id },
    });

    const after = await call<PageDto>('GET', `/pages/${child.id}`, { token: owner.token, workspace: ws });
    expect(after.body.data!.accessRootId).toBe(child.id);
    expect(await consistency()).toEqual(CLEAN);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ลบ / กู้คืน / ลบถาวร
// ═══════════════════════════════════════════════════════════════════════════
describe('ถังขยะ', () => {
  it('ลบหน้าแล้วลูกหลานหายจาก tree ทั้งก้อน', async () => {
    const root = await createPage(owner, ws, { title: 'จะถูกลบ' });
    const child = await createPage(owner, ws, { parentId: root.id, title: 'ลูก' });

    const { status, body } = await call<number>('DELETE', `/pages/${root.id}`, {
      token: owner.token,
      workspace: ws,
    });

    expect(status).toBe(200);
    expect(body.data).toBe(2);

    const tree = await call<PageNodeDto[]>('GET', '/pages', { token: owner.token, workspace: ws });
    const ids = tree.body.data!.map((n) => n.id);
    expect(ids).not.toContain(root.id);
    expect(ids).not.toContain(child.id);

    const trash = await call<PageNodeDto[]>('GET', '/pages/trash', {
      token: owner.token,
      workspace: ws,
    });
    expect(trash.body.data!.map((n) => n.id)).toContain(root.id);
  });

  it('กู้คืนขณะที่หน้าแม่ยังอยู่ในถังขยะ → 409 ไม่ใช่หน้ากำพร้า', async () => {
    const root = await createPage(owner, ws, { title: 'แม่' });
    const child = await createPage(owner, ws, { parentId: root.id, title: 'ลูก' });

    await call('DELETE', `/pages/${root.id}`, { token: owner.token, workspace: ws });

    const { status, body } = await call('POST', `/pages/${child.id}/restore`, {
      token: owner.token,
      workspace: ws,
    });

    expect(status).toBe(409);
    expect(body.code).toBe('parent_still_deleted');
  });

  it('กู้คืนจากบนลงล่างได้ และหน้ากลับมาใน tree', async () => {
    const root = await createPage(owner, ws, { title: 'จะกู้' });
    const child = await createPage(owner, ws, { parentId: root.id, title: 'ลูก' });

    await call('DELETE', `/pages/${root.id}`, { token: owner.token, workspace: ws });
    const restored = await call<number>('POST', `/pages/${root.id}/restore`, {
      token: owner.token,
      workspace: ws,
    });

    expect(restored.status).toBe(200);
    expect(restored.body.data).toBe(2);

    const tree = await call<PageNodeDto[]>('GET', '/pages', { token: owner.token, workspace: ws });
    expect(tree.body.data!.map((n) => n.id)).toContain(child.id);
  });

  it('สมาชิกลบหน้าของตัวเองแล้วกู้คืนได้', async () => {
    // ─────────────────────────────────────────────────────────────────
    //  ⚠️ นี่คือบั๊กที่ฝั่ง .NET เคยเจอ: การตรวจสิทธิ์ตัวปกติมองไม่เห็นหน้าที่
    //     ถูกลบ (เงื่อนไข deleted_at IS NULL ตัดแถวออกก่อน JOIN) แล้วทุกคนที่
    //     ไม่ใช่ owner/admin จะได้ "ไม่มีสิทธิ์" เสมอ
    //
    //     อาการ: สมาชิกลบหน้าของตัวเอง เห็นมันอยู่ในถังขยะ กดกู้คืนแล้วได้ 404
    //     "ไม่พบหน้านี้" ทั้งที่เพิ่งเห็นมันอยู่
    // ─────────────────────────────────────────────────────────────────
    const member = await register();
    await join(ws, member.userId, 'member');

    const page = await createPage(member, ws, { title: 'หน้าของสมาชิก' });

    expect((await call('DELETE', `/pages/${page.id}`, { token: member.token, workspace: ws })).status).toBe(200);

    const restored = await call('POST', `/pages/${page.id}/restore`, {
      token: member.token,
      workspace: ws,
    });

    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
  });

  it('ลบถาวรต้องผ่านถังขยะก่อน และเป็นงานของ owner/admin', async () => {
    const member = await register();
    await join(ws, member.userId, 'member');

    const page = await createPage(owner, ws, { title: 'จะลบถาวร' });

    const tooEarly = await call('DELETE', `/pages/${page.id}/purge`, {
      token: owner.token,
      workspace: ws,
    });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.code).toBe('not_deleted');

    await call('DELETE', `/pages/${page.id}`, { token: owner.token, workspace: ws });

    const asMember = await call('DELETE', `/pages/${page.id}/purge`, {
      token: member.token,
      workspace: ws,
    });
    expect(asMember.status).toBe(403);

    const purged = await call<number>('DELETE', `/pages/${page.id}/purge`, {
      token: owner.token,
      workspace: ws,
    });
    expect(purged.status).toBe(200);
    expect(purged.body.data).toBe(1);
  });

  it('ลบถาวรแล้วประวัติยังอ่านได้ โดย page_id กลายเป็น NULL', async () => {
    // ⚠️ ถ้า FK เป็น CASCADE เหมือนตารางลูกอื่น การ purge จะลบหลักฐานพอดีตอนที่
    //    คำถาม "ใครลบหน้าชื่ออะไร" มีค่าที่สุด
    const page = await createPage(owner, ws, { title: 'หน้าที่จะหายไป' });
    await call('DELETE', `/pages/${page.id}`, { token: owner.token, workspace: ws });
    await call('DELETE', `/pages/${page.id}/purge`, { token: owner.token, workspace: ws });

    const { rows } = await admin.query<{ page_id: string | null; page_title: string; action: string }>(
      `SELECT page_id, page_title, action FROM activity_logs
        WHERE workspace_id = $1 AND page_title = 'หน้าที่จะหายไป' ORDER BY id`,
      [ws],
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.page_id === null)).toBe(true);
    expect(rows.map((r) => r.action)).toContain('page_created');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  สิทธิ์
// ═══════════════════════════════════════════════════════════════════════════
describe('สิทธิ์ระดับหน้า', () => {
  it('หน้าที่แชร์ให้คนเดียวไม่โผล่ใน tree ของคนอื่น', async () => {
    const wsPrivate = await seedWorkspace(owner.userId, 'owner');
    const alice = await register();
    const bob = await register();
    await join(wsPrivate, alice.userId, 'member');
    await join(wsPrivate, bob.userId, 'member');

    const secret = await createPage(owner, wsPrivate, { title: 'ความลับ' });

    // เปลี่ยนจาก grant ระดับ workspace เป็น grant เฉพาะ alice
    await admin.query('DELETE FROM page_acls WHERE page_id = $1', [secret.id]);
    await admin.query(
      `INSERT INTO page_acls (page_id, workspace_id, subject_type, subject_id, role)
       VALUES ($1, $2, 'user', $3, 'editor')`,
      [secret.id, wsPrivate, alice.userId],
    );

    const aliceTree = await call<PageNodeDto[]>('GET', '/pages', {
      token: alice.token,
      workspace: wsPrivate,
    });
    const bobTree = await call<PageNodeDto[]>('GET', '/pages', {
      token: bob.token,
      workspace: wsPrivate,
    });

    expect(aliceTree.body.data!.map((n) => n.id)).toContain(secret.id);
    expect(bobTree.body.data!.map((n) => n.id)).not.toContain(secret.id);

    // bob รู้ id ตรง ๆ ก็ยังไม่เห็น และได้ 404 ไม่ใช่ 403
    const direct = await call('GET', `/pages/${secret.id}`, {
      token: bob.token,
      workspace: wsPrivate,
    });
    expect(direct.status).toBe(404);
    expect(direct.body.code).toBe('page_not_found');
  });

  it('ถังขยะก็กรองตามสิทธิ์ ไม่ใช่โชว์ทุกหน้าใน workspace', async () => {
    // ⚠️ ต่างจากฝั่ง .NET ที่ไม่กรองถังขยะเลย — member จึงเห็นชื่อหน้าที่ตัวเอง
    //    ไม่เคยมีสิทธิ์เห็นได้ผ่านหน้าถังขยะ
    const wsTrash = await seedWorkspace(owner.userId, 'owner');
    const alice = await register();
    const bob = await register();
    await join(wsTrash, alice.userId, 'member');
    await join(wsTrash, bob.userId, 'member');

    const secret = await createPage(owner, wsTrash, { title: 'ลับแล้วลบ' });
    await admin.query('DELETE FROM page_acls WHERE page_id = $1', [secret.id]);
    await admin.query(
      `INSERT INTO page_acls (page_id, workspace_id, subject_type, subject_id, role)
       VALUES ($1, $2, 'user', $3, 'editor')`,
      [secret.id, wsTrash, alice.userId],
    );

    await call('DELETE', `/pages/${secret.id}`, { token: alice.token, workspace: wsTrash });

    const bobTrash = await call<PageNodeDto[]>('GET', '/pages/trash', {
      token: bob.token,
      workspace: wsTrash,
    });
    expect(bobTrash.body.data!.map((n) => n.id)).not.toContain(secret.id);

    const aliceTrash = await call<PageNodeDto[]>('GET', '/pages/trash', {
      token: alice.token,
      workspace: wsTrash,
    });
    expect(aliceTrash.body.data!.map((n) => n.id)).toContain(secret.id);
  });

  it('guest สร้างหน้าระดับบนสุดไม่ได้ แต่สร้างใต้หน้าที่แชร์ให้ได้', async () => {
    const wsGuest = await seedWorkspace(owner.userId, 'owner');
    const guest = await register();
    await join(wsGuest, guest.userId, 'guest');

    const shared = await createPage(owner, wsGuest, { title: 'แชร์ให้แขก' });
    await admin.query(
      `INSERT INTO page_acls (page_id, workspace_id, subject_type, subject_id, role)
       VALUES ($1, $2, 'user', $3, 'editor')`,
      [shared.id, wsGuest, guest.userId],
    );

    const topLevel = await call('POST', '/pages', {
      token: guest.token,
      workspace: wsGuest,
      body: { title: 'ไม่ควรได้' },
    });
    expect(topLevel.status).toBe(403);
    expect(topLevel.body.code).toBe('insufficient_role');

    const child = await call<PageDto>('POST', '/pages', {
      token: guest.token,
      workspace: wsGuest,
      body: { parentId: shared.id, title: 'ลูกที่แขกสร้าง' },
    });
    expect(child.status, JSON.stringify(child.body)).toBe(201);
  });

  it('guest ไม่ได้สิทธิ์จาก grant ระดับ workspace', async () => {
    // ไม่งั้น guest จะเห็นทุกหน้าใน workspace ทันทีที่ถูกเชิญ ซึ่งขัดกับนิยาม
    const wsGuest = await seedWorkspace(owner.userId, 'owner');
    const guest = await register();
    await join(wsGuest, guest.userId, 'guest');

    const open = await createPage(owner, wsGuest, { title: 'หน้าเปิดของ workspace' });

    const tree = await call<PageNodeDto[]>('GET', '/pages', {
      token: guest.token,
      workspace: wsGuest,
    });
    expect(tree.body.data!.map((n) => n.id)).not.toContain(open.id);

    // ─────────────────────────────────────────────────────────────────
    //  ⚠️ ต้องเช็คทางเข้าตรงด้วย ไม่ใช่แค่รายการใน sidebar
    //
    //  สองทางนี้ใช้โค้ดคนละเส้นกัน: sidebar กรองด้วย visibleAccessRoots()
    //  ส่วนการเปิดหน้าตรง ๆ ผ่าน effectiveRole() ซึ่งมีตัวกรอง guest ของตัวเอง
    //  mutation test จับได้ว่าเทสเดิมเช็คแต่เส้นแรก — ถอดตัวกรองใน
    //  effectiveRole ออกแล้วเทสยังเขียวทั้งชุด ทั้งที่ guest เปิดหน้าได้แล้ว
    // ─────────────────────────────────────────────────────────────────
    const direct = await call('GET', `/pages/${open.id}`, {
      token: guest.token,
      workspace: wsGuest,
    });
    expect(direct.status).toBe(404);
    expect(direct.body.code).toBe('page_not_found');

    // และแก้ไม่ได้ด้วย ไม่ใช่แค่มองไม่เห็น
    const edit = await call('PATCH', `/pages/${open.id}`, {
      token: guest.token,
      workspace: wsGuest,
      body: { title: 'แขกแก้' },
    });
    expect(edit.status).toBe(404);
  });

  it('หน้าของ workspace อื่นมองไม่เห็นแม้รู้ id', async () => {
    const other = await seedWorkspace(owner.userId, 'owner');
    const page = await createPage(owner, other, { title: 'ของอีก workspace' });

    const { status, body } = await call('GET', `/pages/${page.id}`, {
      token: owner.token,
      workspace: ws,
    });

    expect(status).toBe(404);
    expect(body.code).toBe('page_not_found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ซ่อม
// ═══════════════════════════════════════════════════════════════════════════
describe('ตรวจและซ่อม', () => {
  it('จับ ancestor_ids และ access_root_id ที่เพี้ยนได้ แล้วซ่อมกลับ', async () => {
    const wsRepair = await seedWorkspace(owner.userId, 'owner');
    const root = await createPage(owner, wsRepair, { title: 'ราก' });
    const a = await createPage(owner, wsRepair, { parentId: root.id, title: 'ลูก ก' });
    const b = await createPage(owner, wsRepair, { parentId: root.id, title: 'ลูก ข' });

    expect(await consistency(wsRepair)).toEqual(CLEAN);

    // ─────────────────────────────────────────────────────────────────
    //  ทำให้เพี้ยนด้วยบัญชี owner ของฐาน (ข้าม RLS และข้ามโค้ดทั้งหมด)
    //
    //  ⚠️ ต้องเพี้ยนคนละแบบ ไม่ใช่แบบเดียวกันทั้งคู่ — ถ้าล้าง ancestor_ids
    //     พร้อมเซ็ต access_root_id = id ในแถวเดียวกัน ค่าที่ได้จะ "ถูกต้อง
    //     ในตัวเอง" (หน้าที่ไม่มีบรรพบุรุษและไม่มี ACL ต้องเป็น root ของตัวเอง)
    //     แล้วตัวตรวจจะรายงานว่าไม่มีอะไรผิด ซึ่งถูกของมัน
    //
    //  ⚠️ depth ต้องเพี้ยนตาม ancestor_ids ไม่งั้น ck_pages_depth_matches_ancestors
    //     ปฏิเสธการเขียนตั้งแต่แรก — ซึ่งก็คือ constraint นั้นทำงานถูกต้อง
    // ─────────────────────────────────────────────────────────────────

    // ก: ancestors ถูก แต่ access root ชี้ผิด
    await admin.query('UPDATE pages SET access_root_id = id WHERE id = $1', [a.id]);
    // ข: ancestors หาย (access root ก็พลอยผิดตามเพราะคำนวณจาก ancestors)
    await admin.query(
      'UPDATE pages SET ancestor_ids = ARRAY[]::uuid[], depth = 0 WHERE id = $1',
      [b.id],
    );

    const broken = await consistency(wsRepair);
    expect(broken.badAncestors).toBe(1);
    expect(broken.badAccessRoots).toBe(2);
    expect(broken.orphans).toBe(0);

    const repaired = await call<{ fixedAncestors: number; fixedAccessRoots: number }>(
      'POST',
      '/pages/maintenance/repair',
      { token: owner.token, workspace: wsRepair },
    );

    expect(repaired.status).toBe(200);
    // ⚠️ ซ่อม ancestors ก่อนแล้วค่อย access root — พอ ancestors ของ ข กลับมาถูก
    //    access root ที่คำนวณใหม่ก็ตรงกับค่าที่มีอยู่แล้ว เหลือแค่ ก ที่ต้องแก้
    expect(repaired.body.data).toEqual({ fixedAncestors: 1, fixedAccessRoots: 1 });
    expect(await consistency(wsRepair)).toEqual(CLEAN);

    for (const page of [a, b]) {
      const after = await call<PageDto>('GET', `/pages/${page.id}`, {
        token: owner.token,
        workspace: wsRepair,
      });
      expect(after.body.data!.ancestorIds).toEqual([root.id]);
      expect(after.body.data!.accessRootId).toBe(root.id);
    }
  });

  it('member เรียก maintenance ไม่ได้', async () => {
    const member = await register();
    await join(ws, member.userId, 'member');

    expect(
      (await call('GET', '/pages/maintenance/consistency', { token: member.token, workspace: ws })).status,
    ).toBe(403);
    expect(
      (await call('POST', '/pages/maintenance/repair', { token: member.token, workspace: ws })).status,
    ).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  แก้ไข
// ═══════════════════════════════════════════════════════════════════════════
describe('แก้ไขหน้า', () => {
  it('เปลี่ยนชื่อแล้ว page_searches ตามไปด้วย', async () => {
    const page = await createPage(owner, ws, { title: 'ชื่อเดิม' });

    await call('PATCH', `/pages/${page.id}`, {
      token: owner.token,
      workspace: ws,
      body: { title: 'ชื่อใหม่' },
    });

    const { rows } = await admin.query<{ title: string }>(
      'SELECT title FROM page_searches WHERE page_id = $1',
      [page.id],
    );
    expect(rows[0]?.title).toBe('ชื่อใหม่');
  });

  it('แก้ไอคอนแล้ว last_edited_by ขยับตาม', async () => {
    // ⚠️ ของเดิม UpdateIcon ลืมเซ็ต last_edited_by ต่างจาก title/status
    //    ผลคือ updated_at ขยับแต่คนแก้ยังเป็นคนก่อนหน้า = ประวัติที่โกหกเงียบ ๆ
    const page = await createPage(owner, ws, { title: 'หน้า' });
    const member = await register();
    await join(ws, member.userId, 'member');

    await call('PATCH', `/pages/${page.id}`, {
      token: member.token,
      workspace: ws,
      body: { icon: '📘' },
    });

    const { rows } = await admin.query<{ last_edited_by: string; icon: string }>(
      'SELECT last_edited_by, icon FROM pages WHERE id = $1',
      [page.id],
    );

    expect(rows[0]?.icon).toBe('📘');
    expect(rows[0]?.last_edited_by).toBe(member.userId);
  });

  it('ล้างไอคอนได้ด้วย null', async () => {
    // ของเดิมแยก "ไม่แตะ" กับ "ล้าง" ไม่ออก (null แปลว่าไม่แตะ) จึงล้างไม่ได้เลย
    const page = await createPage(owner, ws, { title: 'หน้า', icon: '📗' });

    await call('PATCH', `/pages/${page.id}`, {
      token: owner.token,
      workspace: ws,
      body: { icon: null },
    });

    const after = await call<PageDto>('GET', `/pages/${page.id}`, { token: owner.token, workspace: ws });
    expect(after.body.data!.icon).toBeNull();
  });

  it('ส่งสถานะเดิมซ้ำ ไม่เพิ่มแถวในฟีดกิจกรรม', async () => {
    const page = await createPage(owner, ws, { title: 'งาน', status: 'todo' });

    const countChanges = async () => {
      const { rows } = await admin.query<{ n: number }>(
        `SELECT count(*)::int n FROM activity_logs WHERE page_id = $1 AND action = 'status_changed'`,
        [page.id],
      );
      return rows[0]!.n;
    };

    await call('PATCH', `/pages/${page.id}`, {
      token: owner.token,
      workspace: ws,
      body: { status: 'todo' },
    });
    expect(await countChanges()).toBe(0);

    await call('PATCH', `/pages/${page.id}`, {
      token: owner.token,
      workspace: ws,
      body: { status: 'done' },
    });
    expect(await countChanges()).toBe(1);
  });

  it('viewer แก้ไม่ได้', async () => {
    const wsView = await seedWorkspace(owner.userId, 'owner');
    const viewer = await register();
    await join(wsView, viewer.userId, 'member');

    const page = await createPage(owner, wsView, { title: 'อ่านได้อย่างเดียว' });
    await admin.query(`UPDATE page_acls SET role = 'viewer' WHERE page_id = $1`, [page.id]);

    const { status, body } = await call('PATCH', `/pages/${page.id}`, {
      token: viewer.token,
      workspace: wsView,
      body: { title: 'แก้ไม่ได้' },
    });

    expect(status).toBe(403);
    expect(body.code).toBe('insufficient_page_role');
  });
});
