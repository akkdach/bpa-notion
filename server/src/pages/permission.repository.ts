import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { currentSession } from '../db/db.service.js';
import { pageAcls, pages } from '../db/schema.js';
import type { AclSubjectType, PageRole } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  PermissionRepository — ชั้นอ่านข้อมูลของการตรวจสิทธิ์
//
//  แยกออกมาจาก PermissionService เพราะ service แตะฐานข้อมูลเองไม่ได้
//  (บังคับด้วย scripts/check-architecture.mjs) การเขียนรวมกันไว้ตอนแรกทำให้
//  gate แดง ซึ่งถูกแล้ว — ฝั่ง .NET ก็แยกด้วยเหตุผลเดียวกัน (PermissionQueries)
// ═══════════════════════════════════════════════════════════════════════════

export interface AclGrant {
  subjectType: AclSubjectType;
  role: PageRole;
}

function db() {
  const session = currentSession();
  if (!session) throw new Error('เรียก repository นอก DbService.withScope()');
  return session.db;
}

@Injectable()
export class PermissionRepository {
  async pageExists(pageId: string, includeDeleted: boolean): Promise<boolean> {
    const [row] = await db()
      .select({ one: sql<number>`1` })
      .from(pages)
      .where(includeDeleted ? eq(pages.id, pageId) : and(eq(pages.id, pageId), isNull(pages.deletedAt)))
      .limit(1);

    return row !== undefined;
  }

  /**
   * grant ทั้งหมดที่มีผลกับหน้านี้ — query เดียวที่ความลึกคงที่
   *
   * ⚠️ JOIN ที่ pages.access_root_id ไม่ใช่ pages.id — access_root_id ชี้ตรงไป
   *    ที่ ancestor ที่ใกล้ที่สุดซึ่งมี ACL อยู่แล้ว จึงไม่ต้องไล่ขึ้น tree ไม่ว่า
   *    หน้าจะซ้อนกันลึกกี่ชั้น
   *
   * ⚠️ includeDeleted ใช้กับหน้าที่อยู่ในถังขยะเท่านั้น — เงื่อนไข deleted_at
   *    ตัดแถว pages ออกก่อน JOIN จะได้ทำงาน ผลคือ "ไม่มี grant" ซึ่งอ่านเป็น
   *    "ไม่มีสิทธิ์" (ดูอาการที่ PermissionService.resolveForDeleted)
   */
  grantsForPage(pageId: string, userId: string, includeDeleted: boolean): Promise<AclGrant[]> {
    return db()
      .select({ subjectType: pageAcls.subjectType, role: pageAcls.role })
      .from(pages)
      .innerJoin(pageAcls, eq(pageAcls.pageId, pages.accessRootId))
      .where(
        and(
          eq(pages.id, pageId),
          includeDeleted ? undefined : isNull(pages.deletedAt),
          or(
            and(eq(pageAcls.subjectType, 'user'), eq(pageAcls.subjectId, userId)),
            eq(pageAcls.subjectType, 'workspace'),
          ),
        ),
      ) as Promise<AclGrant[]>;
  }

  /** access root ทั้งหมดที่ผู้ใช้มองเห็น — เซ็ตเดียวกรองได้ทั้ง tree */
  async visibleAccessRoots(userId: string, includeWorkspaceWide: boolean): Promise<string[]> {
    const rows = await db()
      .selectDistinct({ pageId: pageAcls.pageId })
      .from(pageAcls)
      .where(
        or(
          and(eq(pageAcls.subjectType, 'user'), eq(pageAcls.subjectId, userId)),
          // guest เห็นเฉพาะหน้าที่ถูกแชร์ให้ตัวเขาเอง
          includeWorkspaceWide ? eq(pageAcls.subjectType, 'workspace') : sql`false`,
        ),
      );

    return rows.map((r) => r.pageId);
  }
}
