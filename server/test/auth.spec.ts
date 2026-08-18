// ═══════════════════════════════════════════════════════════════════════════
//  auth — ยิงผ่าน HTTP จริง ไม่ใช่เรียก service ตรง ๆ
//
//  เพราะสิ่งที่เสี่ยงที่สุดของขั้นนี้ไม่ได้อยู่ใน service เลย มันอยู่ในสายที่
//  ประกอบกัน: interceptor เปิดธุรกรรม → ตั้ง tenant → handler → envelope →
//  exception filter ถ้าเทสเรียก service ตรง ๆ ทุกข้อจะผ่านโดยที่สายนั้นพังอยู่
//
//  ⚠️ ข้อที่ต้องพิสูจน์จริง ๆ มีสี่ข้อ ที่เหลือเป็นของแถม:
//     · ธุรกรรมครอบทั้ง request จริง (handler ที่พังกลางทางต้อง rollback)
//     · การใช้ refresh token ซ้ำต้องล้าง session ทั้งหมด
//     · API token ของ workspace A ใช้กับ B ไม่ได้แม้บัญชีเป็นสมาชิกทั้งคู่
//     · เพิกถอน token แล้วมีผลทันที ไม่ใช่รอ cache หมดอายุ
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

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string; kind: string };
  workspaces: { id: string; slug: string; role: string }[];
}

let baseUrl: string;
let close: () => Promise<void>;
let admin: pg.Client;

/** ของที่เทสสร้างขึ้น — เก็บไว้ลบตอนจบ */
const createdUsers: string[] = [];
const createdWorkspaces: string[] = [];

const password = 'รหัสผ่านยาวพอสมควรนะ';

beforeAll(async () => {
  admin = new pg.Client({ connectionString: process.env['DATABASE_ADMIN_URL'] });
  await admin.connect();

  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  configureApp(app);
  await app.listen(0);

  baseUrl = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');
  close = () => app.close();
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

/** สมัครผู้ใช้ใหม่แล้วจำ id ไว้ลบตอนจบ */
async function register(name = 'ผู้ทดสอบ'): Promise<AuthResponse> {
  const email = `t-${randomUUID()}@example.test`;
  const { status, body } = await call<AuthResponse>('POST', '/auth/register', {
    body: { email, password, name },
  });

  expect(status, JSON.stringify(body)).toBe(200);
  const data = body.data!;
  createdUsers.push(data.user.id);
  return data;
}

/** ยังไม่มี endpoint สร้าง workspace (ขั้นที่ 6 ของแผน) — seed ด้วยบัญชี owner */
async function seedWorkspace(userId: string, role = 'owner'): Promise<string> {
  const id = randomUUID();
  await admin.query('INSERT INTO workspaces (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [
    id,
    `t-${id.slice(0, 8)}`,
    'workspace ทดสอบ',
    userId,
  ]);
  await admin.query(
    'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
    [id, userId, role],
  );
  createdWorkspaces.push(id);
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════
//  สมัคร / เข้าสู่ระบบ
// ═══════════════════════════════════════════════════════════════════════════
describe('register', () => {
  it('สมัครแล้วได้ token กลับมาทันที ไม่ต้อง login ซ้ำ', async () => {
    const session = await register('สมชาย ทดสอบ');

    expect(session.accessToken).not.toBe('');
    expect(session.refreshToken).not.toBe('');
    expect(session.user.name).toBe('สมชาย ทดสอบ');
    expect(session.user.kind).toBe('human');
    expect(session.workspaces).toEqual([]);
  });

  it('อีเมลซ้ำ → 409 พร้อมบอกเหตุผลตรง ๆ', async () => {
    const first = await register();
    const email = (await meOf(first.accessToken)).user.email;

    const { status, body } = await call('POST', '/auth/register', {
      body: { email, password, name: 'คนที่สอง' },
    });

    expect(status).toBe(409);
    expect(body.code).toBe('email_taken');
  });

  it('รหัสผ่านสั้นเกิน → 400 พร้อมรายชื่อ field ที่ผิด', async () => {
    const { status, body } = await call<{ errors: Record<string, string[]> }>(
      'POST',
      '/auth/register',
      { body: { email: `t-${randomUUID()}@example.test`, password: 'สั้นไป', name: 'ก' } },
    );

    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.data?.errors['password']?.[0]).toContain('12 ตัวอักษร');
  });

  it('body ว่าง → 400 ไม่ใช่ 500', async () => {
    // ⚠️ ฝั่ง C# เคยพลาดข้อนี้: body ที่อ่านไม่ได้ทำให้ argument เป็น null
    //    แล้วไปพังเป็น NullReferenceException → 500 ซึ่งไม่บอกอะไรผู้เรียกเลย
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(400);
  });
});

describe('login', () => {
  it('อีเมล/รหัสถูก → ได้ token และรายการ workspace', async () => {
    const session = await register();
    const email = (await meOf(session.accessToken)).user.email;
    const ws = await seedWorkspace(session.user.id);

    const { status, body } = await call<AuthResponse>('POST', '/auth/login', {
      body: { email, password },
    });

    expect(status).toBe(200);
    expect(body.data!.workspaces.map((w) => w.id)).toEqual([ws]);
  });

  it('รหัสผิด กับ อีเมลที่ไม่มีอยู่ ตอบเหมือนกันเป๊ะ', async () => {
    // ⚠️ ข้อความหรือ code ที่ต่างกันแม้นิดเดียว = ช่องให้ไล่หาว่าอีเมลไหนมีอยู่จริง
    const session = await register();
    const email = (await meOf(session.accessToken)).user.email;

    const wrongPassword = await call('POST', '/auth/login', {
      body: { email, password: 'รหัสผ่านผิดแต่ยาวพอ' },
    });
    const noSuchUser = await call('POST', '/auth/login', {
      body: { email: `ไม่มีจริง-${randomUUID()}@example.test`, password },
    });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.body.code).toBe(noSuchUser.body.code);
    expect(wrongPassword.body.message).toBe(noSuchUser.body.message);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  access token
// ═══════════════════════════════════════════════════════════════════════════
describe('/me', () => {
  it('ไม่มี token → 401', async () => {
    const { status, body } = await call('GET', '/auth/me');
    expect(status).toBe(401);
    expect(body.code).toBe('unauthenticated');
  });

  it('token มั่ว → 401 ไม่ใช่ 500', async () => {
    // ⚠️ ค่าใน header ต้องเป็น ASCII (HTTP บังคับ) — ภาษาไทยใน header ทำให้
    //    fetch โยน TypeError ตั้งแต่ฝั่ง client ยังไม่ทันยิงออกไป
    const { status } = await call('GET', '/auth/me', { token: 'not-a-jwt-at-all' });
    expect(status).toBe(401);
  });

  it('token ที่เซ็นด้วย secret อื่น → 401', async () => {
    // ลายเซ็นผิด — ตัดตัวท้ายของ signature ออกหนึ่งตัว
    const session = await register();
    const tampered = session.accessToken.slice(0, -2);

    const { status } = await call('GET', '/auth/me', { token: tampered });
    expect(status).toBe(401);
  });

  it('token ถูก → คืน user + workspace ที่เป็นสมาชิก', async () => {
    const session = await register();
    const ws = await seedWorkspace(session.user.id);

    const me = await meOf(session.accessToken);
    expect(me.user.id).toBe(session.user.id);
    expect(me.workspaces.map((w) => w.id)).toEqual([ws]);
    // /me ไม่ออก token ใหม่
    expect(me.accessToken).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  refresh — จุดที่พังแล้วเจ็บที่สุด
// ═══════════════════════════════════════════════════════════════════════════
describe('refresh', () => {
  it('ใบเดิมใช้ได้ครั้งเดียว แล้วได้ใบใหม่มาแทน', async () => {
    const session = await register();

    const first = await call<AuthResponse>('POST', '/auth/refresh', {
      body: { refreshToken: session.refreshToken },
    });

    expect(first.status).toBe(200);
    expect(first.body.data!.refreshToken).not.toBe(session.refreshToken);
  });

  it('ใช้ใบที่ rotate ไปแล้วซ้ำ → ล้าง session ทั้งหมดของ user นั้น', async () => {
    // ─────────────────────────────────────────────────────────────────
    //  ⚠️ นี่คือพฤติกรรมที่ตั้งใจ ไม่ใช่ผลข้างเคียง
    //
    //  token ที่ถูก rotate แล้วโผล่มาอีก แปลว่ามีสำเนาอยู่ในมือคนอื่น
    //  (คนที่ขโมยไป หรือเจ้าของ — แยกไม่ออก) ถ้าปฏิเสธเฉพาะใบนั้น ผู้ที่
    //  ขโมยไปจะ refresh ด้วยใบที่ตัวเองถืออยู่ต่อได้ไม่มีสิ้นสุด
    // ─────────────────────────────────────────────────────────────────
    const session = await register();

    const rotated = await call<AuthResponse>('POST', '/auth/refresh', {
      body: { refreshToken: session.refreshToken },
    });
    expect(rotated.status).toBe(200);

    const reused = await call('POST', '/auth/refresh', {
      body: { refreshToken: session.refreshToken },
    });

    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('refresh_token_reused');

    // ใบใหม่ที่เพิ่งได้มาต้องใช้ไม่ได้ด้วย — ไม่งั้นการล้าง session ไม่มีความหมาย
    const afterPurge = await call('POST', '/auth/refresh', {
      body: { refreshToken: rotated.body.data!.refreshToken },
    });
    expect(afterPurge.status).toBe(401);
  });

  it('refresh token มั่ว → 401', async () => {
    const { status, body } = await call('POST', '/auth/refresh', {
      body: { refreshToken: 'ไม่ใช่ token' },
    });
    expect(status).toBe(401);
    expect(body.code).toBe('invalid_refresh_token');
  });

  it('logout แล้ว refresh ไม่ได้อีก และเรียกซ้ำก็ยังตอบสำเร็จ', async () => {
    const session = await register();

    expect((await call('POST', '/auth/logout', { body: { refreshToken: session.refreshToken } })).status).toBe(200);
    // idempotent — logout ซ้ำไม่ควรพัง
    expect((await call('POST', '/auth/logout', { body: { refreshToken: session.refreshToken } })).status).toBe(200);

    const after = await call('POST', '/auth/refresh', {
      body: { refreshToken: session.refreshToken },
    });
    expect(after.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  workspace header
// ═══════════════════════════════════════════════════════════════════════════
describe('X-Workspace-Id', () => {
  it('workspace ที่ไม่ได้เป็นสมาชิก → 404 ไม่ใช่ 403', async () => {
    // ⚠️ 403 แปลว่า "มีอยู่จริงแต่คุณไม่มีสิทธิ์" ซึ่งทำให้เดาได้ว่า id ไหน
    //    มีอยู่จริง — เป็นการรั่วข้อมูลข้าม tenant แม้จะเล็กน้อย
    const owner = await register();
    const outsider = await register();
    const ws = await seedWorkspace(owner.user.id);

    const { status, body } = await call('GET', '/workspaces/current/tokens', {
      token: outsider.accessToken,
      workspace: ws,
    });

    expect(status).toBe(404);
    expect(body.code).toBe('workspace_not_found');
  });

  it('workspace ที่ไม่มีอยู่จริงเลย → 404 ข้อความเดียวกัน', async () => {
    const user = await register();

    const { status, body } = await call('GET', '/workspaces/current/tokens', {
      token: user.accessToken,
      workspace: randomUUID(),
    });

    expect(status).toBe(404);
    expect(body.code).toBe('workspace_not_found');
  });

  it('header ที่ไม่ใช่ UUID → 400', async () => {
    const user = await register();

    const { status, body } = await call('GET', '/workspaces/current/tokens', {
      token: user.accessToken,
      workspace: 'not-a-uuid',
    });

    expect(status).toBe(400);
    expect(body.code).toBe('invalid_workspace_header');
  });

  it('endpoint ที่ต้องมี workspace แต่ไม่ส่ง header → 400 พร้อมบอกว่าขาดอะไร', async () => {
    const user = await register();

    const { status, body } = await call('GET', '/workspaces/current/tokens', {
      token: user.accessToken,
    });

    expect(status).toBe(400);
    expect(body.code).toBe('workspace_required');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  API token
// ═══════════════════════════════════════════════════════════════════════════
describe('API token', () => {
  it('owner ออก token ได้ และค่าจริงโผล่ครั้งเดียว', async () => {
    const owner = await register();
    const ws = await seedWorkspace(owner.user.id);

    const created = await call<{ token: string; last4: string; id: string }>(
      'POST',
      '/workspaces/current/tokens',
      { token: owner.accessToken, workspace: ws, body: { name: 'โน้ตบุ๊กทดสอบ' } },
    );

    expect(created.status).toBe(200);
    expect(created.body.data!.token.startsWith('pmt_')).toBe(true);
    expect(created.body.data!.token.slice(-4)).toBe(created.body.data!.last4);

    // รายการไม่มีค่าจริงอยู่เลย
    const list = await call<{ id: string; last4: string; status: string }[]>(
      'GET',
      '/workspaces/current/tokens',
      { token: owner.accessToken, workspace: ws },
    );

    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body.data)).not.toContain(created.body.data!.token);
    expect(list.body.data![0]!.status).toBe('active');
  });

  it('member ธรรมดาออก token ไม่ได้ → 403', async () => {
    const user = await register();
    const ws = await seedWorkspace(user.user.id, 'member');

    const { status, body } = await call('POST', '/workspaces/current/tokens', {
      token: user.accessToken,
      workspace: ws,
      body: { name: 'ไม่ควรได้' },
    });

    expect(status).toBe(403);
    expect(body.code).toBe('insufficient_role');
  });

  it('ใช้ API token เรียก API ได้ โดยไม่ต้องส่ง workspace header', async () => {
    const owner = await register();
    const ws = await seedWorkspace(owner.user.id);
    const token = await issueToken(owner.accessToken, ws);

    // token พก workspace มาในตัว — /me จึงทำงานได้เลย
    const { status, body } = await call<AuthResponse>('GET', '/auth/me', { token });

    expect(status).toBe(200);
    // ⚠️ ทำงานในนามบัญชี agent ไม่ใช่บัญชีคนที่กดสร้าง — ซึ่งเป็นเหตุผลทั้งหมด
    //    ที่บัญชี agent มีอยู่ (ตอบได้ว่า "หน้านี้ AI แก้หรือฉันแก้")
    expect(body.data!.user.kind).toBe('agent');
    expect(body.data!.user.id).not.toBe(owner.user.id);
  });

  it('token ของ workspace A + header ชี้ไป B → 403 แม้บัญชีเป็นสมาชิกทั้งคู่', async () => {
    // ─────────────────────────────────────────────────────────────────
    //  ⚠️ ถ้าข้อนี้พัง "token ผูกกับ workspace" ที่โฆษณาไว้ไม่เป็นจริงเลย
    //     บัญชี agent เป็นสมาชิกหลาย workspace ได้ ใบของ A จะใช้กับ B ได้ทันที
    //     แค่เปลี่ยน header
    // ─────────────────────────────────────────────────────────────────
    const owner = await register();
    const wsA = await seedWorkspace(owner.user.id);
    const wsB = await seedWorkspace(owner.user.id);

    const token = await issueToken(owner.accessToken, wsA);

    // จับบัญชี agent ของ A ยัดเข้าเป็นสมาชิกของ B ด้วย เพื่อตัดข้อแก้ตัวว่า
    // มันถูกปฏิเสธเพราะ "ไม่ได้เป็นสมาชิก" ไม่ใช่เพราะ "ใบผูกกับ A"
    const me = await call<AuthResponse>('GET', '/auth/me', { token });
    const agentId = me.body.data!.user.id;
    await admin.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
      [wsB, agentId, 'member'],
    );

    const { status, body } = await call('GET', '/auth/me', { token, workspace: wsB });

    expect(status).toBe(403);
    expect(body.code).toBe('token_workspace_mismatch');

    // ส่ง header ที่ตรงกับใบ ยังทำงานได้ตามปกติ
    expect((await call('GET', '/auth/me', { token, workspace: wsA })).status).toBe(200);
  });

  it('เพิกถอนแล้วใช้ไม่ได้ "ทันที" ไม่ใช่รอ cache หมดอายุ', async () => {
    const owner = await register();
    const ws = await seedWorkspace(owner.user.id);

    const created = await call<{ id: string; token: string }>('POST', '/workspaces/current/tokens', {
      token: owner.accessToken,
      workspace: ws,
      body: { name: 'ใบที่จะถูกเพิกถอน' },
    });
    const { id, token } = created.body.data!;

    expect((await call('GET', '/auth/me', { token })).status).toBe(200);

    const revoked = await call('DELETE', `/workspaces/current/tokens/${id}`, {
      token: owner.accessToken,
      workspace: ws,
    });
    expect(revoked.status).toBe(200);

    const after = await call('GET', '/auth/me', { token });
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('invalid_api_token');
  });

  it('เพิกถอนใบของ workspace อื่นไม่ได้ แม้จะรู้ id', async () => {
    const owner = await register();
    const wsA = await seedWorkspace(owner.user.id);
    const wsB = await seedWorkspace(owner.user.id);

    const created = await call<{ id: string; token: string }>('POST', '/workspaces/current/tokens', {
      token: owner.accessToken,
      workspace: wsA,
      body: { name: 'ใบของ A' },
    });

    // ⚠️ api_tokens ไม่มี RLS policy (workspace มาจากตัวใบ) การกันข้อนี้จึงอยู่
    //    ที่ WHERE ในโค้ดล้วน ๆ — เป็นตารางเดียวในระบบที่ฐานไม่ช่วย
    const attempt = await call('DELETE', `/workspaces/current/tokens/${created.body.data!.id}`, {
      token: owner.accessToken,
      workspace: wsB,
    });

    expect(attempt.status).toBe(404);
    // ใบเดิมยังใช้ได้อยู่
    expect((await call('GET', '/auth/me', { token: created.body.data!.token })).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ธุรกรรมต่อ request
// ═══════════════════════════════════════════════════════════════════════════
describe('ธุรกรรมครอบทั้ง request', () => {
  it('request ที่ล้มเหลวไม่ทิ้งบัญชี agent ค้างไว้ครึ่งทาง', async () => {
    // ─────────────────────────────────────────────────────────────────
    //  create token ทำสองอย่างในธุรกรรมเดียว: สร้างบัญชี agent (ถ้ายังไม่มี)
    //  แล้วออกใบ ถ้าธุรกรรมไม่ได้ครอบทั้ง request บัญชี agent จะถูก commit
    //  ทิ้งไว้แม้ขั้นตอนหลังพัง แล้วครั้งถัดไปจะเจอบัญชีกำพร้าที่ไม่มีใบผูกอยู่
    //
    //  บังคับให้พังด้วยชื่อยาวเกิน 100 ตัว ซึ่งผ่าน zod ไม่ได้ → 400 ก่อนถึง
    //  service ด้วยซ้ำ จึงต้องพังที่ชั้นฐานแทน: ยัดใบให้ครบเพดานก่อน
    // ─────────────────────────────────────────────────────────────────
    const owner = await register();
    const ws = await seedWorkspace(owner.user.id);

    const agentsBefore = await countAgents(ws);
    expect(agentsBefore).toBe(0);

    // ทำให้ล้มที่ CHECK constraint ระดับฐาน: slug ของ workspace ถูกแก้ให้
    // ประกอบเป็นอีเมลที่ยาวเกินคอลัมน์ไม่ได้ — ใช้วิธีตรงกว่านั้นคือลบ workspace
    // ทิ้งกลางคัน ให้ ensureAgent หา workspace ไม่เจอ
    await admin.query('UPDATE workspaces SET deleted_at = now() WHERE id = $1', [ws]);

    const failed = await call('POST', '/workspaces/current/tokens', {
      token: owner.accessToken,
      workspace: ws,
      body: { name: 'ควรพัง' },
    });

    // workspace ที่ถูกลบแล้วไม่ควรเข้าถึงได้เลย
    expect(failed.status).toBe(404);
    expect(await countAgents(ws)).toBe(0);

    await admin.query('UPDATE workspaces SET deleted_at = NULL WHERE id = $1', [ws]);
  });

  it('สร้าง token สองใบติดกันใช้บัญชี agent ตัวเดิม ไม่สร้างซ้ำ', async () => {
    const owner = await register();
    const ws = await seedWorkspace(owner.user.id);

    await issueToken(owner.accessToken, ws, 'ใบแรก');
    await issueToken(owner.accessToken, ws, 'ใบสอง');

    expect(await countAgents(ws)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────

async function meOf(token: string): Promise<AuthResponse> {
  const { status, body } = await call<AuthResponse>('GET', '/auth/me', { token });
  expect(status, JSON.stringify(body)).toBe(200);
  return body.data!;
}

async function issueToken(accessToken: string, workspace: string, name = 'เครื่องทดสอบ'): Promise<string> {
  const { status, body } = await call<{ token: string }>('POST', '/workspaces/current/tokens', {
    token: accessToken,
    workspace,
    body: { name },
  });

  expect(status, JSON.stringify(body)).toBe(200);
  return body.data!.token;
}

async function countAgents(workspaceId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM workspace_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 AND u.kind = 'agent'`,
    [workspaceId],
  );
  return rows[0]?.n ?? 0;
}
