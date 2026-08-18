import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import { currentSession } from '../db/db.service.js';
import { activityLogs, pageNotes, users } from '../db/schema.js';
import type { ActivityRow } from '../domain/activity.js';
import type { UserKind } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  บันทึกบนหน้า + ฟีดกิจกรรม
//
//  ⚠️ การ "เขียน" activity ส่วนใหญ่ไม่ได้เกิดที่นี่ แต่เกิดใน PageRepository
//     ซึ่งเป็นที่ที่การเปลี่ยนแปลงเกิดขึ้นจริง
//
//     ถ้าเขียน log จาก service หลังจาก mutation สำเร็จ log จะโกหกได้สองทาง:
//     mutation สำเร็จแต่ log ล้ม (ประวัติหาย) หรือ log สำเร็จแต่ mutation
//     rollback (ประวัติบอกถึงสิ่งที่ไม่เคยเกิด) — ทั้งคู่แย่กว่าไม่มีประวัติ
//
//     ที่นี่ปัญหานั้นหมดไปโดยโครงสร้าง เพราะทั้ง request เป็นธุรกรรมเดียว
// ═══════════════════════════════════════════════════════════════════════════

export interface NoteRow {
  id: string;
  pageId: string;
  authorUserId: string | null;
  authorName: string | null;
  authorKind: UserKind | null;
  body: string;
  createdAt: string;
}

export interface ActivityFeedRow {
  id: number;
  pageId: string | null;
  pageTitle: string;
  actorUserId: string | null;
  actorName: string | null;
  actorKind: UserKind | null;
  action: string;
  detail: unknown;
  createdAt: string;
}

function db() {
  const session = currentSession();
  if (!session) throw new Error('เรียก repository นอก DbService.withScope()');
  return session.db;
}

@Injectable()
export class CollaborationRepository {
  async addNote(
    note: {
      id: string;
      workspaceId: string;
      pageId: string;
      authorUserId: string;
      body: string;
    },
    activity: ActivityRow,
  ): Promise<void> {
    await db().insert(pageNotes).values(note);
    await db().insert(activityLogs).values(activity);
  }

  listNotes(pageId: string, limit: number): Promise<NoteRow[]> {
    return db()
      .select({
        id: pageNotes.id,
        pageId: pageNotes.pageId,
        authorUserId: pageNotes.authorUserId,
        // left join — ผู้เขียนอาจถูกลบบัญชีไปแล้ว แต่บันทึกต้องยังอ่านได้
        authorName: users.name,
        authorKind: users.kind,
        body: pageNotes.body,
        createdAt: pageNotes.createdAt,
      })
      .from(pageNotes)
      .leftJoin(users, eq(users.id, pageNotes.authorUserId))
      .where(eq(pageNotes.pageId, pageId))
      .orderBy(asc(pageNotes.createdAt), asc(pageNotes.id))
      .limit(limit) as Promise<NoteRow[]>;
  }

  listActivity(input: {
    pageId: string | null;
    visiblePageIds: readonly string[] | null;
    since: string | null;
    limit: number;
  }): Promise<ActivityFeedRow[]> {
    const filters = [];

    if (input.pageId !== null) {
      filters.push(eq(activityLogs.pageId, input.pageId));
    } else if (input.visiblePageIds !== null) {
      // ⚠️ แถวที่หน้าถูกลบถาวรไปแล้ว (page_id = null) ต้องติดมาด้วย — นั่นคือ
      //    กรณีที่คำถาม "ใครลบหน้าชื่ออะไร" มีค่าที่สุด
      filters.push(
        input.visiblePageIds.length === 0
          ? isNull(activityLogs.pageId)
          : or(isNull(activityLogs.pageId), inArray(activityLogs.pageId, [...input.visiblePageIds]))!,
      );
    }

    if (input.since !== null) filters.push(gt(activityLogs.createdAt, input.since));

    return db()
      .select({
        id: activityLogs.id,
        pageId: activityLogs.pageId,
        pageTitle: activityLogs.pageTitle,
        actorUserId: activityLogs.actorUserId,
        actorName: users.name,
        actorKind: users.kind,
        action: activityLogs.action,
        detail: activityLogs.detail,
        createdAt: activityLogs.createdAt,
      })
      .from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.actorUserId))
      .where(filters.length > 0 ? and(...filters) : sql`true`)
      // เรียงด้วย id ปิดท้ายเพราะหลายเหตุการณ์เกิดใน now() เดียวกันได้ (เขียนใน
      // ธุรกรรมเดียว) ถ้าไม่มีตัวตัดสิน ลำดับจะไม่คงที่ระหว่างการเรียกซ้ำ
      .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(input.limit) as Promise<ActivityFeedRow[]>;
  }
}
