import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { currentSession } from '../db/db.service.js';
import { apiTokens, users, workspaceMembers, workspaces } from '../db/schema.js';
import type { UserKind } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  ApiTokenRepository
//
//  ⚠️⚠️ api_tokens เป็นตารางเดียวที่มี workspace_id แต่ "ไม่มี" RLS policy
//
//     เหตุผลอยู่ใน sql/objects.sql: การ resolve token เกิดก่อนที่ระบบจะรู้ว่า
//     request นี้อยู่ workspace ไหน — เพราะตัว token เป็นคนบอก ถ้าใส่ policy
//     การ lookup จะไม่เจออะไรเลย
//
//     ผลคือ **ทุก query ในไฟล์นี้ต้องเขียน workspace_id ใน WHERE เอง**
//     ฐานข้อมูลไม่ได้ช่วยที่นี่เหมือนตารางอื่น ลืมแล้วรั่วทันที
//     (test/api-tokens.spec.ts มีเทสยิงข้ามworkspace ทุก method ที่รับ id)
// ═══════════════════════════════════════════════════════════════════════════

export interface ApiTokenPrincipal {
  tokenId: string;
  workspaceId: string;
  userId: string;
}

export interface ApiTokenRow {
  id: string;
  name: string;
  last4: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * เขียน last_used_at ถี่แค่ไหน
 *
 * ⚠️ ถ้าเขียนทุก request ทุกการ "อ่าน" ผ่าน token จะกลายเป็นการ "เขียน" ฐาน
 *    ซึ่งแพงและทำให้ read replica ใช้ไม่ได้ในอนาคต
 *
 *    ความละเอียดระดับ 5 นาทีพอสำหรับสิ่งที่คนใช้ค่านี้จริง ๆ คือ "ใบนี้ยังมีใคร
 *    ใช้อยู่ไหม" ไม่ใช่ audit log รายคำขอ (ซึ่งคือ activity_logs)
 */
const TOUCH_INTERVAL = '5 minutes';

function db() {
  const session = currentSession();
  if (!session) throw new Error('เรียก repository นอก DbService.withScope()');
  return session.db;
}

@Injectable()
export class ApiTokenRepository {
  /**
   * ตรวจว่าใบนี้ยังใช้ได้ไหม แล้วบอกว่ามันเป็นของใครใน workspace ไหน
   *
   * ⚠️ ตรวจแค่ "ตัวใบ" ที่นี่ — อีกสองข้อที่ของเดิมรวมไว้ในคิวรีเดียวกัน
   *    (ยังเป็นสมาชิกอยู่ไหม · workspace ยังไม่ถูกลบไหม) ย้ายไปอยู่ที่
   *    IdentityRepository.resolveMembership ซึ่ง interceptor เรียกต่อทันที
   *
   *    ไม่ได้หายไป และไม่ได้หลวมลง — ย้ายเพราะสองข้อนั้นต้องอ่าน
   *    workspace_members/workspaces ที่มี RLS ส่วน query นี้ต้องรันนอก tenant
   *    scope (ยังไม่รู้ว่า workspace ไหน) ถ้ารวมไว้ที่เดียว join จะคืนศูนย์แถว
   *    เสมอเพราะ policy กรองอีกสองตารางออกหมด
   *
   *    ข้อดีที่ได้แถมมา: การถอดบัญชี AI ออกจาก workspace มีผลทันทีเหมือนเดิม
   *    และตอนนี้เส้นทางนั้นเป็นเส้นเดียวกับ JWT ใช้ ไม่ใช่โค้ดคนละชุด
   */
  async resolve(tokenHash: string): Promise<ApiTokenPrincipal | null> {
    const [row] = await db()
      .select({
        tokenId: apiTokens.id,
        workspaceId: apiTokens.workspaceId,
        userId: apiTokens.userId,
      })
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.tokenHash, tokenHash),
          isNull(apiTokens.revokedAt),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, sql`now()`)),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** เงื่อนไขเวลาอยู่ใน WHERE ไม่ใช่ใน JS — สอง request พร้อมกันจึงไม่เขียนซ้อนกัน */
  async touch(tokenId: string): Promise<void> {
    await db()
      .update(apiTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          or(
            isNull(apiTokens.lastUsedAt),
            sql`${apiTokens.lastUsedAt} < now() - ${TOUCH_INTERVAL}::interval`,
          ),
        ),
      );
  }

  list(workspaceId: string): Promise<ApiTokenRow[]> {
    return db()
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        last4: apiTokens.last4,
        createdAt: apiTokens.createdAt,
        expiresAt: apiTokens.expiresAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.workspaceId, workspaceId))
      .orderBy(desc(apiTokens.createdAt));
  }

  async create(input: {
    workspaceId: string;
    userId: string;
    name: string;
    tokenHash: string;
    last4: string;
    createdBy: string;
    expiresAt: Date | null;
  }): Promise<ApiTokenRow> {
    const [row] = await db()
      .insert(apiTokens)
      .values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        name: input.name,
        tokenHash: input.tokenHash,
        last4: input.last4,
        createdBy: input.createdBy,
        expiresAt: input.expiresAt?.toISOString() ?? null,
      })
      .returning({
        id: apiTokens.id,
        name: apiTokens.name,
        last4: apiTokens.last4,
        createdAt: apiTokens.createdAt,
        expiresAt: apiTokens.expiresAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
      });

    if (!row) throw new Error('INSERT api_tokens ไม่คืนแถว');
    return row;
  }

  /** ⚠️ workspaceId อยู่ใน WHERE ด้วยเสมอ — ไม่งั้นรู้ id ใบเดียวก็เพิกถอนของ workspace อื่นได้ */
  async revoke(workspaceId: string, tokenId: string): Promise<boolean> {
    const rows = await db()
      .update(apiTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.workspaceId, workspaceId),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning({ id: apiTokens.id });

    return rows.length > 0;
  }

  /** slug ของ workspace — ใช้ประกอบอีเมลของบัญชี agent */
  async findWorkspaceSlug(workspaceId: string): Promise<string | null> {
    const [row] = await db()
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    return row?.slug ?? null;
  }

  async emailExists(email: string): Promise<boolean> {
    const [row] = await db()
      .select({ one: sql<number>`1` })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return row !== undefined;
  }

  /**
   * สร้างบัญชี agent แล้วใส่เข้า workspace ในธุรกรรมเดียวกัน
   *
   * ⚠️ role เป็น member ไม่ใช่ guest — guest สร้างหน้าระดับบนสุดไม่ได้ แล้ว AI
   *    จะเจอ Forbidden ซ้ำ ๆ ไม่จบ
   */
  async createAgent(input: {
    workspaceId: string;
    email: string;
    passwordHash: string;
  }): Promise<string> {
    const [agent] = await db()
      .insert(users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        name: 'Claude (AI)',
        kind: 'agent',
        locale: 'th',
      })
      .returning({ id: users.id });

    if (!agent) throw new Error('INSERT users (agent) ไม่คืนแถว');

    await db()
      .insert(workspaceMembers)
      .values({ workspaceId: input.workspaceId, userId: agent.id, role: 'member' });

    return agent.id;
  }

  /** บัญชี agent ที่เก่าที่สุดของ workspace นี้ — null เมื่อยังไม่เคยสร้าง */
  async findAgent(workspaceId: string): Promise<{ id: string } | null> {
    const [row] = await db()
      .select({ id: users.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(users.kind, 'agent' satisfies UserKind),
        ),
      )
      .orderBy(users.createdAt)
      .limit(1);

    return row ?? null;
  }
}
