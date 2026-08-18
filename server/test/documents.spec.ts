// ═══════════════════════════════════════════════════════════════════════════
//  documents — Yjs storage · bootstrap · snapshot/compact · projection · append
//
//  ⚠️ สิ่งที่ต้องพิสูจน์ที่นี่คือของที่เทสระดับหน่วยจับไม่ได้:
//     · รูปแบบไบนารีของ bootstrap ตรงกับที่ web/ แกะจริง
//     · snapshot ที่หดผิดปกติไม่ถูกใช้เสิร์ฟ และไม่ prune update ทิ้ง
//     · AI เขียนเนื้อหาแล้วค้นเจอทันที ไม่ต้องรอเบราว์เซอร์เปิดหน้า
// ═══════════════════════════════════════════════════════════════════════════

import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

process.env['DATABASE_POOL_MAX'] = '5';

const { AppModule } = await import('../src/app.module.js');
const { configureApp } = await import('../src/bootstrap.js');

interface Envelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
}

let baseUrl: string;
let close: () => Promise<void>;
let admin: pg.Client;

const createdUsers: string[] = [];
const createdWorkspaces: string[] = [];
const password = 'รหัสผ่านยาวพอสมควรนะ';

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
  ws = await seedWorkspace(owner.userId);
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

/** ยิง body เป็นไบต์ดิบ เหมือนที่ web/ ทำ */
async function callBinary<T>(
  path: string,
  bytes: Uint8Array,
  token = owner.token,
  workspace = ws,
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      authorization: `Bearer ${token}`,
      'x-workspace-id': workspace,
    },
    // ⚠️ ส่ง Uint8Array ตรง ๆ ไม่ใช่ JSON.stringify — cast เพราะ tsconfig ไม่มี
    //    lib DOM (เซิร์ฟเวอร์ไม่ควรมี type ของเบราว์เซอร์ปนอยู่ทั้งโปรเจกต์)
    body: bytes as unknown as string,
  });

  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function register(): Promise<{ token: string; userId: string }> {
  const { body } = await call<{ accessToken: string; user: { id: string } }>('POST', '/auth/register', {
    body: { email: `t-${randomUUID()}@example.test`, password, name: 'ผู้ทดสอบ' },
  });
  createdUsers.push(body.data!.user.id);
  return { token: body.data!.accessToken, userId: body.data!.user.id };
}

async function seedWorkspace(userId: string, role = 'owner'): Promise<string> {
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

async function createPage(title = 'หน้าเอกสาร', workspace = ws, token = owner.token): Promise<string> {
  const { status, body } = await call<{ id: string }>('POST', '/pages', {
    token,
    workspace,
    body: { title },
  });
  expect(status, JSON.stringify(body)).toBe(201);
  return body.data!.id;
}

/** ดึง bootstrap แล้วแกะ frame แบบเดียวกับ web/src/features/editor/service/docApi.ts */
async function bootstrap(pageId: string, token = owner.token, workspace = ws) {
  const response = await fetch(`${baseUrl}/pages/${pageId}/ydoc`, {
    headers: { authorization: `Bearer ${token}`, 'x-workspace-id': workspace },
  });

  if (response.status !== 200) {
    return { status: response.status, frames: [] as Uint8Array[], headers: response.headers };
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);

  const frames: Uint8Array[] = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const length = view.getUint32(offset, true);
    offset += 4;
    frames.push(bytes.subarray(offset, offset + length));
    offset += length;
  }

  return { status: response.status, frames, headers: response.headers };
}

/** ประกอบเอกสารจาก frame แล้วอ่านข้อความออกมา */
async function textOf(frames: Uint8Array[]): Promise<string> {
  const { readPlainText } = await import('../src/documents/blocknote.js');
  return readPlainText(frames.filter((f) => f.length > 0));
}

/** update ปลอมที่ Yjs ยอมรับ — ใช้ทดสอบทางส่งข้อมูลโดยไม่ต้องมีเนื้อหาจริง */
function fakeUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText('t').insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

// ═══════════════════════════════════════════════════════════════════════════
//  bootstrap
// ═══════════════════════════════════════════════════════════════════════════
describe('bootstrap', () => {
  it('หน้าใหม่ที่ยังไม่มีเนื้อหา → frame เดียวที่ยาวศูนย์', async () => {
    const pageId = await createPage();
    const { status, frames, headers } = await bootstrap(pageId);

    expect(status).toBe(200);
    // frame แรกคือ snapshot เสมอ — ยาว 0 เมื่อยังไม่เคย compact
    expect(frames).toHaveLength(1);
    expect(frames[0]!.length).toBe(0);
    expect(headers.get('x-doc-role')).toBe('full');
    expect(headers.get('x-doc-head-seq')).toBe('0');
    expect(headers.get('x-doc-should-compact')).toBe('0');
    expect(headers.get('cache-control')).toBe('no-store');
  });

  it('รูปแบบไบนารีแกะได้ด้วยตัวแกะฝั่งเว็บ และ update เรียงตาม seq', async () => {
    const pageId = await createPage();

    for (const word of ['หนึ่ง', 'สอง', 'สาม']) {
      const { status } = await callBinary(`/pages/${pageId}/ydoc/update`, fakeUpdate(word));
      expect(status).toBe(200);
    }

    const { frames, headers } = await bootstrap(pageId);

    expect(frames).toHaveLength(4); // snapshot ว่าง + 3 update
    expect(headers.get('x-doc-head-seq')).not.toBe('0');

    // ประกอบกลับแล้วต้องได้ครบทั้งสาม (Yjs merge ให้เอง)
    const doc = new Y.Doc();
    for (const f of frames) if (f.length > 0) Y.applyUpdate(doc, f);
    const text = doc.getText('t').toJSON();
    for (const word of ['หนึ่ง', 'สอง', 'สาม']) expect(text).toContain(word);
  });

  it('หน้าที่ไม่มีสิทธิ์เห็น → 404 ไม่ใช่ไบนารีว่าง', async () => {
    const outsider = await register();
    const pageId = await createPage();

    const { status } = await bootstrap(pageId, outsider.token, ws);
    expect(status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ส่ง update
// ═══════════════════════════════════════════════════════════════════════════
describe('ส่ง update', () => {
  it('body ว่าง → 400 ไม่ใช่ 500', async () => {
    const pageId = await createPage();
    const { status, body } = await callBinary(`/pages/${pageId}/ydoc/update`, new Uint8Array(0));

    expect(status).toBe(400);
    expect(body.code).toBe('empty_body');
  });

  it('ส่งเป็น JSON แทนไบนารี → 400 พร้อมบอกว่าต้องเป็นอะไร', async () => {
    // ⚠️ ถ้าไม่ดักตรงนี้ express.raw() จะปล่อย req.body เป็น {} แล้ว error
    //    ที่ได้จะชี้ไปผิดทาง ("ไม่มีข้อมูลใน body")
    const pageId = await createPage();
    const { status, body } = await call('POST', `/pages/${pageId}/ydoc/update`, {
      token: owner.token,
      workspace: ws,
      body: { update: 'ไม่ใช่ไบนารี' },
    });

    expect(status).toBe(400);
    expect(body.code).toBe('expected_binary_body');
  });

  it('viewer ส่ง update ไม่ได้', async () => {
    const wsView = await seedWorkspace(owner.userId);
    const viewer = await register();
    await admin.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)', [
      wsView,
      viewer.userId,
      'member',
    ]);

    const pageId = await createPage('อ่านอย่างเดียว', wsView);
    await admin.query(`UPDATE page_acls SET role = 'viewer' WHERE page_id = $1`, [pageId]);

    const { status, body } = await callBinary(
      `/pages/${pageId}/ydoc/update`,
      fakeUpdate('ไม่ควรเขียนได้'),
      viewer.token,
      wsView,
    );

    expect(status).toBe(403);
    expect(body.code).toBe('insufficient_page_role');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  snapshot / compact — trust boundary จุดเดียวของระบบ
// ═══════════════════════════════════════════════════════════════════════════
describe('snapshot', () => {
  /** ยัด update ให้ครบ n ก้อน แล้วคืน headSeq */
  async function fill(pageId: string, n: number): Promise<number> {
    for (let i = 0; i < n; i++) {
      await callBinary(`/pages/${pageId}/ydoc/update`, fakeUpdate(`ก้อน ${i}`));
    }
    const { headers } = await bootstrap(pageId);
    return Number(headers.get('x-doc-head-seq'));
  }

  it('upToSeq ล้ำหน้า update ล่าสุด → 400', async () => {
    const pageId = await createPage();
    const head = await fill(pageId, 2);

    const { status, body } = await callBinary(
      `/pages/${pageId}/ydoc/snapshot?upToSeq=${head + 100}`,
      fakeUpdate('snapshot'),
    );

    expect(status).toBe(400);
    expect(body.code).toBe('snapshot_ahead');
  });

  it('มี snapshot ที่ seq เดียวกันแล้ว → 409 ไม่ใช่ 500 จาก unique index', async () => {
    // เกิดจริงเมื่อสอง client ตัดสินใจ compact ที่ seq เดียวกันพร้อมกัน
    const pageId = await createPage();
    const head = await fill(pageId, 2);
    const snapshot = fakeUpdate('snapshot ก้อนใหญ่พอสมควรเลยนะ');

    expect((await callBinary(`/pages/${pageId}/ydoc/snapshot?upToSeq=${head}`, snapshot)).status).toBe(200);

    const second = await callBinary(`/pages/${pageId}/ydoc/snapshot?upToSeq=${head}`, snapshot);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('snapshot_exists');
  });

  it('snapshot ที่หดตัวแรง: ไม่ใช้เสิร์ฟ ไม่ prune และ update เดิมยังอยู่ครบ', async () => {
    // ─────────────────────────────────────────────────────────────────
    //  ⚠️ นี่คือด่านที่เทสฝั่ง .NET จับได้ว่าดีไซน์เดิมไม่พอ:
    //     "เก็บไว้แต่ไม่ prune" อย่างเดียวยังพัง เพราะ bootstrap หยิบ snapshot
    //     ที่ up_to_seq สูงสุดมาเสิร์ฟแล้วข้าม update ที่เก่ากว่าไปหมด — ข้อมูล
    //     ยังอยู่ในฐานครบ แต่ผู้ใช้เห็นหน้าว่าง ซึ่งแย่พอกับข้อมูลหายจริง
    // ─────────────────────────────────────────────────────────────────
    const pageId = await createPage();
    const head1 = await fill(pageId, 3);

    const big = fakeUpdate('เนื้อหายาวมากจนขนาดของ snapshot ใหญ่พอที่จะเทียบสัดส่วนได้อย่างมีความหมาย'.repeat(4));
    expect((await callBinary(`/pages/${pageId}/ydoc/snapshot?upToSeq=${head1}`, big)).status).toBe(200);

    const head2 = await fill(pageId, 2);
    const tiny = fakeUpdate('สั้น');

    const shrunk = await callBinary<{ pruneSkipped: boolean; prunedUpdates: number }>(
      `/pages/${pageId}/ydoc/snapshot?upToSeq=${head2}`,
      tiny,
    );

    expect(shrunk.status).toBe(200);
    expect(shrunk.body.data!.pruneSkipped).toBe(true);
    expect(shrunk.body.data!.prunedUpdates).toBe(0);

    // bootstrap ต้องยังเสิร์ฟ snapshot ตัวใหญ่ ไม่ใช่ตัวที่หด
    const { headers } = await bootstrap(pageId);
    expect(Number(headers.get('x-doc-snapshot-up-to'))).toBe(head1);

    // และ update ที่เกิดหลัง snapshot ตัวใหญ่ต้องยังอยู่
    const { rows } = await admin.query<{ n: number }>(
      'SELECT count(*)::int n FROM page_doc_updates WHERE page_id = $1',
      [pageId],
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  });

  it('snapshot ที่หดแล้วมีพยานยืนยัน → เชื่อและ prune ได้', async () => {
    // ถ้าตัวถัดไปขนาดใกล้กัน แปลว่าเนื้อหาหดจริง (ผู้ใช้ลบเยอะ) ไม่ใช่
    // client ตัวเดียวส่งของไม่ครบ
    const pageId = await createPage();
    const head1 = await fill(pageId, 2);

    const big = fakeUpdate('เนื้อหายาวมากพอที่จะทำให้ขนาดต่างกันชัดเจน'.repeat(6));
    await callBinary(`/pages/${pageId}/ydoc/snapshot?upToSeq=${head1}`, big);

    // ⚠️ สองก้อนนี้ต้องขนาดใกล้กัน (±25%) ถึงจะนับเป็นการยืนยัน — ใช้เนื้อหา
    //    เดียวกันเพราะนั่นคือสิ่งที่เกิดจริง: สอง client ที่เห็นเอกสารซึ่งถูกลบ
    //    เนื้อหาไปแล้วเหมือนกัน จะผลิต snapshot ขนาดพอ ๆ กัน
    //
    //    รอบแรกเคยใช้ข้อความยาวต่างกันเล็กน้อย ได้อัตราส่วน 0.746 ซึ่งตกเกณฑ์
    //    ไปนิดเดียว — เป็นข้อมูลเทสที่บังเอิญอยู่ตรงขอบ ไม่ใช่โค้ดผิด
    const shrunkContent = 'เหลือแค่นี้';

    const head2 = await fill(pageId, 2);
    const first = await callBinary<{ pruneSkipped: boolean }>(
      `/pages/${pageId}/ydoc/snapshot?upToSeq=${head2}`,
      fakeUpdate(shrunkContent),
    );
    expect(first.body.data!.pruneSkipped).toBe(true);

    const head3 = await fill(pageId, 2);
    const witnessed = await callBinary<{ pruneSkipped: boolean }>(
      `/pages/${pageId}/ydoc/snapshot?upToSeq=${head3}`,
      fakeUpdate(shrunkContent),
    );

    expect(witnessed.status).toBe(200);
    expect(witnessed.body.data!.pruneSkipped).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  projection + content
// ═══════════════════════════════════════════════════════════════════════════
describe('projection และการอ่านเนื้อหา', () => {
  it('หน้าที่เพิ่งสร้างมีแถว projection แล้ว → freshness = from_document', async () => {
    // ⚠️ ก่อนหน้านี้แถวนี้เกิดเมื่อเบราว์เซอร์ POST /projection เท่านั้น หน้าที่
    //    AI สร้างจึงไม่มีแถวเลย และ freshness = never ตลอดไป
    const pageId = await createPage('หน้าใหม่เอี่ยม');
    const { status, body } = await call<{ freshness: string; bodyText: string; title: string }>(
      'GET',
      `/pages/${pageId}/content`,
      { token: owner.token, workspace: ws },
    );

    expect(status).toBe(200);
    expect(body.data!.freshness).toBe('from_document');
    expect(body.data!.bodyText).toBe('');
    expect(body.data!.title).toBe('หน้าใหม่เอี่ยม');
  });

  it('ส่ง projection แล้วอ่านกลับได้ และ title ไปโผล่ที่ pages', async () => {
    const pageId = await createPage('ชื่อเดิม');

    await call('POST', `/pages/${pageId}/projection`, {
      token: owner.token,
      workspace: ws,
      body: { title: 'ชื่อจากเอกสาร', plainText: 'บรรทัดหนึ่ง\nบรรทัดสอง' },
    });

    const content = await call<{ bodyText: string; title: string }>('GET', `/pages/${pageId}/content`, {
      token: owner.token,
      workspace: ws,
    });

    expect(content.body.data!.title).toBe('ชื่อจากเอกสาร');
    expect(content.body.data!.bodyText).toBe('บรรทัดหนึ่ง\nบรรทัดสอง');
  });

  it('projection ไม่เขียนประวัติ — ฟีดกิจกรรมต้องไม่ถูกกลบด้วยการพิมพ์', async () => {
    // ⚠️ autosave ส่งทุกครั้งที่หยุดพิมพ์ 2 วินาที ถ้าบันทึกประวัติทุกครั้ง
    //    ฟีดจะเต็มไปด้วยการเปลี่ยนชื่อทีละตัวอักษรจนมองไม่เห็นสิ่งที่ AI ทำ
    const pageId = await createPage('ก');

    for (const title of ['กา', 'การ', 'การท', 'การทำ']) {
      await call('POST', `/pages/${pageId}/projection`, {
        token: owner.token,
        workspace: ws,
        body: { title, plainText: title },
      });
    }

    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int n FROM activity_logs WHERE page_id = $1 AND action = 'page_renamed'`,
      [pageId],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('ไม่ส่ง links = คงของเดิม · ส่ง [] = ล้างทั้งหมด', async () => {
    // ⚠️ ถ้าตีความ "ไม่ส่ง" เป็น [] การ deploy โค้ดใหม่ทับ client เก่าจะล้าง
    //    ลิงก์ของทุกหน้าทิ้งทีละหน้าตามที่ผู้ใช้เปิด
    const source = await createPage('ต้นทาง');
    const target = await createPage('ปลายทาง');

    const links = async () => {
      const { rows } = await admin.query<{ n: number }>(
        'SELECT count(*)::int n FROM page_links WHERE source_page_id = $1',
        [source],
      );
      return rows[0]!.n;
    };

    await call('POST', `/pages/${source}/projection`, {
      token: owner.token,
      workspace: ws,
      body: { title: 'ต้นทาง', plainText: '', links: [target] },
    });
    expect(await links()).toBe(1);

    // ไม่ส่ง links มาเลย
    await call('POST', `/pages/${source}/projection`, {
      token: owner.token,
      workspace: ws,
      body: { title: 'ต้นทาง', plainText: 'แก้เนื้อหา' },
    });
    expect(await links()).toBe(1);

    // ส่ง [] มา
    await call('POST', `/pages/${source}/projection`, {
      token: owner.token,
      workspace: ws,
      body: { title: 'ต้นทาง', plainText: '', links: [] },
    });
    expect(await links()).toBe(0);
  });

  it('mention หน้าที่ไม่มีอยู่ ไม่ทำให้ projection ทั้งหน้าพัง', async () => {
    // ⚠️ ถ้าปล่อยให้ composite FK เป็นคนปฏิเสธ ธุรกรรมทั้ง request จะล้ม
    //    แปลว่า mention หน้าที่เพิ่งถูกลบไปหนึ่งอันทำให้ title ที่ sidebar ใช้
    //    ไม่ถูกอัปเดตด้วย
    const source = await createPage('ต้นทาง');
    const alive = await createPage('ยังอยู่');

    const { status } = await call('POST', `/pages/${source}/projection`, {
      token: owner.token,
      workspace: ws,
      body: { title: 'ชื่อใหม่', plainText: 'x', links: [alive, randomUUID()] },
    });

    expect(status).toBe(200);

    const { rows } = await admin.query<{ n: number }>(
      'SELECT count(*)::int n FROM page_links WHERE source_page_id = $1',
      [source],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('backlinks กรองตามสิทธิ์ของหน้าต้นทาง', async () => {
    // ⚠️ สิทธิ์เห็นหน้า A ไม่ได้แปลว่ามีสิทธิ์รู้ว่าหน้า B ลิงก์มาหา A
    //    ชื่อของ B เองก็เป็นข้อมูลที่รั่วได้
    const wsLink = await seedWorkspace(owner.userId);
    const reader = await register();
    await admin.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)', [
      wsLink,
      reader.userId,
      'member',
    ]);

    const target = await createPage('เป้าหมาย', wsLink);
    const secret = await createPage('แผนลับ', wsLink);

    await call('POST', `/pages/${secret}/projection`, {
      token: owner.token,
      workspace: wsLink,
      body: { title: 'แผนลับ', plainText: '', links: [target] },
    });

    // ปิด "แผนลับ" ไม่ให้ member เห็น
    await admin.query('DELETE FROM page_acls WHERE page_id = $1', [secret]);
    await admin.query(
      `INSERT INTO page_acls (page_id, workspace_id, subject_type, subject_id, role)
       VALUES ($1, $2, 'user', $3, 'editor')`,
      [secret, wsLink, owner.userId],
    );

    const asOwner = await call<{ id: string }[]>('GET', `/pages/${target}/backlinks`, {
      token: owner.token,
      workspace: wsLink,
    });
    const asReader = await call<{ id: string }[]>('GET', `/pages/${target}/backlinks`, {
      token: reader.token,
      workspace: wsLink,
    });

    expect(asOwner.body.data!.map((b) => b.id)).toContain(secret);
    expect(asReader.body.data!.map((b) => b.id)).not.toContain(secret);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  เขียนเนื้อหาจากฝั่งเซิร์ฟเวอร์ — ทางที่ AI ใช้
// ═══════════════════════════════════════════════════════════════════════════
describe('AI เขียนเนื้อหา', () => {
  it('ต่อท้ายย่อหน้าแล้วเบราว์เซอร์อ่านกลับได้ครบ', async () => {
    const pageId = await createPage();

    const { status, body } = await call<{ seq: number; blocks: number }>(
      'POST',
      `/pages/${pageId}/content/paragraphs`,
      { token: owner.token, workspace: ws, body: { paragraphs: ['ย่อหน้าแรก', 'ย่อหน้าที่สอง'] } },
    );

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data!.blocks).toBe(2);

    const { frames } = await bootstrap(pageId);
    expect(await textOf(frames)).toBe('ย่อหน้าแรก\nย่อหน้าที่สอง');
  });

  it('เขียนซ้ำหลายรอบสะสมต่อกัน ไม่ทับของเดิมและไม่หายไปเงียบ ๆ', async () => {
    const pageId = await createPage();

    for (const word of ['หนึ่ง', 'สอง', 'สาม']) {
      const { status } = await call('POST', `/pages/${pageId}/content/paragraphs`, {
        token: owner.token,
        workspace: ws,
        body: { paragraphs: [word] },
      });
      expect(status).toBe(200);
    }

    const { frames } = await bootstrap(pageId);
    expect(await textOf(frames)).toBe('หนึ่ง\nสอง\nสาม');
  });

  it('ย่อหน้าที่มีขึ้นบรรทัดในตัวถูกแตกให้เป็นคนละย่อหน้า', async () => {
    // BlockNote ไม่มีโครงรองรับ newline ภายในย่อหน้าเดียว ปล่อยไว้จะแสดงติดกันหมด
    const pageId = await createPage();

    const { body } = await call<{ blocks: number }>('POST', `/pages/${pageId}/content/paragraphs`, {
      token: owner.token,
      workspace: ws,
      body: { paragraphs: ['บรรทัดหนึ่ง\nบรรทัดสอง'] },
    });

    expect(body.data!.blocks).toBe(2);
    expect(await textOf((await bootstrap(pageId)).frames)).toBe('บรรทัดหนึ่ง\nบรรทัดสอง');
  });

  it('markdown: หัวข้อ รายการ และ mermaid ไม่ถูกฉีก', async () => {
    const pageId = await createPage();

    const { status, body } = await call<{ blocks: number }>('POST', `/pages/${pageId}/content/markdown`, {
      token: owner.token,
      workspace: ws,
      body: { markdown: '# แผนงาน\n\n- ข้อหนึ่ง\n- ข้อสอง\n\n```mermaid\ngraph TD;\nA-->B;\n```' },
    });

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data!.blocks).toBe(4);

    const text = await textOf((await bootstrap(pageId)).frames);
    expect(text).toContain('แผนงาน');
    expect(text).toContain('ข้อหนึ่ง');
    // ⚠️ ผังงานต้องอยู่ครบในบล็อกเดียว ไม่ถูกแตกทีละบรรทัด
    expect(text).toContain('A-->B;');
  });

  it('เนื้อหาที่ AI เขียนค้นเจอทันที ไม่ต้องรอเบราว์เซอร์เปิดหน้า', async () => {
    // ⚠️ ถ้าไม่อัปเดต projection ตรงนี้ ผลงานของ AI จะค้นไม่เจอจนกว่าจะมีคนเปิด
    //    หน้านั้นในเบราว์เซอร์ ซึ่งกลับหัวกลับหางกับเป้าหมายของการให้ AI อ่านงานได้
    const pageId = await createPage();

    await call('POST', `/pages/${pageId}/content/markdown`, {
      token: owner.token,
      workspace: ws,
      body: { markdown: '# สรุปยอดขาย\n\nข้าวผัดกระเพราขายดีที่สุด' },
    });

    const content = await call<{ bodyText: string }>('GET', `/pages/${pageId}/content`, {
      token: owner.token,
      workspace: ws,
    });

    expect(content.body.data!.bodyText).toContain('ข้าวผัดกระเพราขายดีที่สุด');
    // ⚠️ ห้ามมี marker ของ markdown — ฉบับของเบราว์เซอร์ไม่มี ถ้าต่างกันค่าจะ
    //    สลับไปมาทุกครั้งที่มีคนเปิดหน้า แล้วผลค้นหาจะไม่คงที่
    expect(content.body.data!.bodyText).not.toContain('#');

    // และค้นเจอจริงผ่าน PGroonga
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int n FROM page_searches WHERE page_id = $1 AND search_text &@~ 'กระเพรา'`,
      [pageId],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('เขียนต่อจากเนื้อหาที่มีอยู่แล้ว ของเดิมไม่หาย', async () => {
    const pageId = await createPage();

    await call('POST', `/pages/${pageId}/content/markdown`, {
      token: owner.token,
      workspace: ws,
      body: { markdown: '# บทที่หนึ่ง\n\nเนื้อหาเดิม' },
    });
    await call('POST', `/pages/${pageId}/content/markdown`, {
      token: owner.token,
      workspace: ws,
      body: { markdown: '# บทที่สอง\n\nเนื้อหาใหม่' },
    });

    const text = await textOf((await bootstrap(pageId)).frames);
    expect(text).toBe('บทที่หนึ่ง\nเนื้อหาเดิม\nบทที่สอง\nเนื้อหาใหม่');
  });

  it('ย่อหน้าว่างล้วน → 400', async () => {
    const pageId = await createPage();
    const { status, body } = await call('POST', `/pages/${pageId}/content/paragraphs`, {
      token: owner.token,
      workspace: ws,
      body: { paragraphs: ['   ', '\n'] },
    });

    expect(status).toBe(400);
    expect(body.code).toBe('no_paragraphs');
  });

  it('viewer เขียนไม่ได้', async () => {
    const wsView = await seedWorkspace(owner.userId);
    const viewer = await register();
    await admin.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)', [
      wsView,
      viewer.userId,
      'member',
    ]);

    const pageId = await createPage('อ่านอย่างเดียว', wsView);
    await admin.query(`UPDATE page_acls SET role = 'viewer' WHERE page_id = $1`, [pageId]);

    const { status } = await call('POST', `/pages/${pageId}/content/paragraphs`, {
      token: viewer.token,
      workspace: wsView,
      body: { paragraphs: ['ไม่ควรเขียนได้'] },
    });

    expect(status).toBe(403);
  });
});
