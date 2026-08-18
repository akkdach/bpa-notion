import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { currentSession } from '../db/db.service.js';
import { refreshTokens, users, workspaceMembers, workspaces } from '../db/schema.js';
import type { UserKind, WorkspaceRole } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  IdentityRepository — users / refresh_tokens / membership
//
//  ── ต่างจาก IdentityQueries ฝั่ง C# อย่างมีนัยสำคัญ ─────────────────────────
//  ของเดิมไฟล์นั้นมีอยู่เพื่อเป็น "ที่เดียวในระบบที่ข้าม tenant filter ได้" และ
//  มีคอมเมนต์ยาวเตือนว่าทุก method ต้อง filter ด้วย userId ที่ authenticated แล้ว
//  เพราะ IgnoreQueryFilters() ปิดการป้องกันทั้งหมด
//
//  ที่นี่ไม่มีอะไรให้ข้าม — RLS ทำงานอยู่ตลอด และ policy ของ workspaces กับ
//  workspace_members "อนุญาตให้เห็นแถวของตัวเอง" ไว้แล้วโดยตรง (ดู sql/objects.sql)
//  การกรองด้วย userId จึงถูกบังคับโดยฐานข้อมูล ไม่ใช่โดยวินัยของคนเขียนโค้ด
//
//  ⚠️ ทุก method ต้องถูกเรียกจากภายใน DbService.withScope() — currentSession()
//     จะ throw ถ้าไม่ใช่ ซึ่งเป็นสิ่งที่ต้องการ: query ที่หลุดออกนอกธุรกรรม
//     คือ query ที่ไม่มี tenant
// ═══════════════════════════════════════════════════════════════════════════

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  avatarUrl: string | null;
  locale: string;
  kind: UserKind;
}

export interface MembershipRow {
  workspaceId: string;
  slug: string;
  name: string;
  icon: string | null;
  role: WorkspaceRole;
}

export interface StoredRefreshToken {
  id: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  user: { id: string; email: string; name: string } | null;
}

function db() {
  const session = currentSession();
  if (!session) {
    throw new Error('เรียก repository นอก DbService.withScope() — query นี้จะไม่มี tenant');
  }
  return session.db;
}

@Injectable()
export class IdentityRepository {
  // ─── users ──────────────────────────────────────────────────────────────

  /** คอลัมน์เป็น citext — การเทียบไม่สนตัวพิมพ์อยู่แล้ว ไม่ต้อง lower() */
  async findUserByEmail(email: string): Promise<UserRow | null> {
    const [row] = await db().select(USER_COLUMNS).from(users).where(eq(users.email, email)).limit(1);
    return (row as UserRow | undefined) ?? null;
  }

  async findUserById(userId: string): Promise<UserRow | null> {
    const [row] = await db().select(USER_COLUMNS).from(users).where(eq(users.id, userId)).limit(1);
    return (row as UserRow | undefined) ?? null;
  }

  async emailExists(email: string): Promise<boolean> {
    const [row] = await db()
      .select({ one: sql<number>`1` })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row !== undefined;
  }

  async createUser(input: {
    email: string;
    passwordHash: string;
    name: string;
    kind?: UserKind;
  }): Promise<UserRow> {
    const [row] = await db()
      .insert(users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        name: input.name,
        kind: input.kind ?? 'human',
        locale: 'th',
      })
      .returning(USER_COLUMNS);

    if (!row) throw new Error('INSERT users ไม่คืนแถว');
    return row as UserRow;
  }

  async touchLastLogin(userId: string): Promise<void> {
    await db().update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, userId));
  }

  // ─── membership ─────────────────────────────────────────────────────────

  /**
   * workspace ทั้งหมดที่ user เป็นสมาชิก
   *
   * ⚠️ INNER JOIN กับ workspaces ทำให้ workspace ที่ถูก soft-delete หายไปเอง
   *    เพราะเงื่อนไขอยู่ใน WHERE — soft-delete ไม่ได้อยู่ใน RLS โดยเจตนา
   *    (หน้า trash ต้องเห็นของที่ลบแล้ว) จึงต้องเขียนเองทุกครั้งที่ต้องการ
   */
  listMemberships(userId: string): Promise<MembershipRow[]> {
    return db()
      .select({
        workspaceId: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        icon: workspaces.icon,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
      .orderBy(asc(workspaces.name)) as Promise<MembershipRow[]>;
  }

  /**
   * ตรวจสมาชิกภาพเพื่อ "ตั้ง" tenant context
   *
   * null = ไม่ได้เป็นสมาชิก ผู้เรียกต้องตอบ 404 ไม่ใช่ 403 — 403 บอกว่า
   * workspace นี้มีอยู่จริง ซึ่งเป็นการรั่วข้อมูลข้าม tenant
   */
  async resolveMembership(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
    const [row] = await db()
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.workspaceId, workspaceId),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);

    return (row?.role as WorkspaceRole | undefined) ?? null;
  }

  // ─── refresh tokens ─────────────────────────────────────────────────────

  async addRefreshToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<string> {
    const [row] = await db()
      .insert(refreshTokens)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt.toISOString(),
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      })
      .returning({ id: refreshTokens.id });

    if (!row) throw new Error('INSERT refresh_tokens ไม่คืนแถว');
    return row.id;
  }

  async findRefreshTokenWithUser(tokenHash: string): Promise<StoredRefreshToken | null> {
    const [row] = await db()
      .select({
        id: refreshTokens.id,
        userId: refreshTokens.userId,
        expiresAt: refreshTokens.expiresAt,
        revokedAt: refreshTokens.revokedAt,
        userIdJoined: users.id,
        email: users.email,
        name: users.name,
      })
      .from(refreshTokens)
      .leftJoin(users, eq(users.id, refreshTokens.userId))
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      user: row.userIdJoined ? { id: row.userIdJoined, email: row.email!, name: row.name! } : null,
    };
  }

  /**
   * ออกใบใหม่แล้วยกเลิกใบเก่าให้ชี้ไปหากัน
   *
   * ⚠️ ต้องอยู่ในธุรกรรมเดียวกัน — ถ้าใบใหม่ถูกบันทึกแต่ใบเก่าไม่ถูกยกเลิก
   *    จะมี token ใช้งานได้สองใบพร้อมกัน ซึ่งทำให้ตรวจจับการรั่วไม่ได้
   *
   *    ที่นี่ไม่ต้องเปิด transaction เอง — ทั้ง request อยู่ในธุรกรรมเดียวอยู่แล้ว
   *    (ดู RequestContextInterceptor) ซึ่งเป็นผลพลอยได้จากการใช้ RLS
   */
  async rotateRefreshToken(
    currentId: string,
    replacement: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      userAgent: string | null;
      ipAddress: string | null;
    },
  ): Promise<void> {
    const replacementId = await this.addRefreshToken(replacement);

    await db()
      .update(refreshTokens)
      .set({ revokedAt: sql`now()`, replacedByTokenId: replacementId })
      .where(eq(refreshTokens.id, currentId));
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const rows = await db()
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });

    return rows.length;
  }
}

const USER_COLUMNS = {
  id: users.id,
  email: users.email,
  passwordHash: users.passwordHash,
  name: users.name,
  avatarUrl: users.avatarUrl,
  locale: users.locale,
  kind: users.kind,
};
