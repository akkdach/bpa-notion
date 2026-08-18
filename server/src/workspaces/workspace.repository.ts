import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { uuidv7 } from '../common/uuid.js';
import { currentSession } from '../db/db.service.js';
import { users, workspaceMembers, workspaces } from '../db/schema.js';
import type { UserKind, WorkspaceRole } from '../domain/roles.js';

export interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  createdAt: string;
}

export interface MemberRow {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  kind: UserKind;
  joinedAt: string;
}

/** unique violation ของ Postgres */
export const UNIQUE_VIOLATION = '23505';

export const isUniqueViolation = (error: unknown, constraint?: string): boolean => {
  const e = error as { code?: string; constraint?: string } | null;
  if (e?.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || e.constraint === constraint;
};

function db() {
  const session = currentSession();
  if (!session) throw new Error('เรียก repository นอก DbService.withScope()');
  return session.db;
}

@Injectable()
export class WorkspaceRepository {
  /**
   * สร้าง workspace แล้วใส่ผู้สร้างเป็น owner
   *
   * ⚠️ ต้องเรียก enterWorkspace ระหว่างทาง — ก่อนหน้านั้นธุรกรรมยังไม่มี tenant
   *    แถวสมาชิกจึงถูก RLS ปฏิเสธ (ดู sql/objects.sql policy members_write_tenant)
   *
   * ⚠️ โยน error ของ Postgres ต่อเมื่อ slug ชน — ผู้เรียกเป็นคนตัดสินว่าจะลอง
   *    ชื่อใหม่หรือแจ้งผู้ใช้ ดูเหตุผลที่ WorkspaceService.create
   */
  async createWithOwner(input: {
    slug: string;
    name: string;
    icon: string | null;
    creatorId: string;
  }): Promise<WorkspaceRow> {
    const session = currentSession();
    if (!session) throw new Error('createWithOwner ถูกเรียกนอกธุรกรรม');

    // ─────────────────────────────────────────────────────────────────────
    //  ⚠️ ห้ามใช้ INSERT … RETURNING ตรงนี้ และเหตุผลไม่ตรงกับข้อความ error เลย
    //
    //  Postgres เอา policy ของ **SELECT** มาใช้กับแถวที่ RETURNING คืนด้วย
    //  ตอนนั้น workspaces_select ยังไม่ match: app.workspace_id ยังว่าง และแถว
    //  สมาชิกยังไม่ถูกเขียน คำสั่งจึงถูกปฏิเสธ
    //
    //  ที่หลอกคือข้อความที่ได้: "new row violates row-level security policy for
    //  table workspaces" ซึ่งอ่านแล้วเหมือน WITH CHECK ของ INSERT ไม่ผ่าน
    //  ทั้งที่ INSERT เปล่า ๆ (ไม่มี RETURNING) ผ่านสบาย ๆ
    //
    //  ทางแก้คือกำหนด id เองแล้วอ่านกลับ "หลัง" enterWorkspace ซึ่งตอนนั้น
    //  policy ของ SELECT match ด้วย id = app_current_workspace()
    //  — ไม่ต้องผ่อน policy ให้หลวมลงเพื่อรองรับ RETURNING
    // ─────────────────────────────────────────────────────────────────────
    const id = uuidv7();

    await session.db.insert(workspaces).values({
      id,
      slug: input.slug,
      name: input.name,
      icon: input.icon,
      createdBy: input.creatorId,
    });

    await session.enterWorkspace(id);

    await session.db.insert(workspaceMembers).values({
      workspaceId: id,
      userId: input.creatorId,
      role: 'owner',
    });

    const workspace = await this.getCurrent(id);
    if (!workspace) throw new Error('อ่าน workspace ที่เพิ่งสร้างกลับมาไม่ได้');

    return workspace;
  }

  /** workspace ที่ธุรกรรมนี้ทำงานอยู่ — RLS จำกัดให้เหลือตัวเดียวอยู่แล้ว */
  async getCurrent(workspaceId: string): Promise<WorkspaceRow | null> {
    const [row] = await db()
      .select(WORKSPACE_COLUMNS)
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .limit(1);

    return row ?? null;
  }

  async update(workspaceId: string, input: { name: string; icon: string | null }): Promise<void> {
    await db()
      .update(workspaces)
      .set({ name: input.name, icon: input.icon })
      .where(eq(workspaces.id, workspaceId));
  }

  listMembers(workspaceId: string): Promise<MemberRow[]> {
    return db()
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: workspaceMembers.role,
        kind: users.kind,
        joinedAt: workspaceMembers.joinedAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(asc(users.name)) as Promise<MemberRow[]>;
  }

  async countMembers(workspaceId: string): Promise<number> {
    const [row] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));

    return row?.n ?? 0;
  }

  async countOwners(workspaceId: string): Promise<number> {
    const [row] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')));

    return row?.n ?? 0;
  }

  async findMember(workspaceId: string, userId: string): Promise<{ role: WorkspaceRole } | null> {
    const [row] = await db()
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);

    return (row as { role: WorkspaceRole } | undefined) ?? null;
  }

  async addMember(input: { workspaceId: string; userId: string; role: WorkspaceRole }): Promise<string> {
    const [row] = await db()
      .insert(workspaceMembers)
      .values(input)
      .returning({ joinedAt: workspaceMembers.joinedAt });

    if (!row) throw new Error('INSERT workspace_members ไม่คืนแถว');
    return row.joinedAt;
  }

  async updateMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
    await db()
      .update(workspaceMembers)
      .set({ role })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await db()
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  }

  /**
   * ⚠️ users ไม่มี RLS (เป็นข้อมูลระดับ identity) — การจำกัดว่าแก้ได้เฉพาะสมาชิก
   *    ใน workspace ของตัวเองอยู่ที่ service ที่เรียก findMember ก่อนเสมอ
   */
  async updateUserKind(userId: string, kind: UserKind): Promise<void> {
    await db().update(users).set({ kind }).where(eq(users.id, userId));
  }
}

const WORKSPACE_COLUMNS = {
  id: workspaces.id,
  slug: workspaces.slug,
  name: workspaces.name,
  icon: workspaces.icon,
  createdAt: workspaces.createdAt,
};
