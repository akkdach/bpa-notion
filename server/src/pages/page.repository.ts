import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { currentSession } from '../db/db.service.js';
import { activityLogs, pageAcls, pages, pageSearches } from '../db/schema.js';
import type { ActivityRow } from '../domain/activity.js';
import type { PageKind, PageStatus } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  PageRepository
//
//  ── สิ่งที่หายไปเมื่อเทียบกับฝั่ง .NET ────────────────────────────────────
//  ของเดิมมี IScopedSql ที่บังคับให้ raw SQL ทุกเส้นเขียน `workspace_id = @__ws`
//  เอง พร้อมคอมเมนต์เตือนว่า "raw SQL ไม่ผ่าน global query filter" — นั่นคือ
//  ช่องรั่วที่ต้องกันด้วยเครื่องมือ เพราะภาษาไม่ได้ช่วยอะไร
//
//  ที่นี่ไม่มีทั้ง IScopedSql และ `workspace_id =` สักเส้นเดียว RLS กรองให้ทั้ง
//  query ธรรมดาและ raw SQL เหมือนกันหมด รวมถึง UPDATE/DELETE ที่แตะ subtree
//  (policy มีทั้ง USING และ WITH CHECK — ดู sql/objects.sql)
//
//  ── สิ่งที่ต้องระวังแทน ──────────────────────────────────────────────────
//  ⚠️ soft-delete "ไม่ได้" อยู่ใน RLS โดยเจตนา (หน้า trash ต้องเห็นของที่ลบแล้ว)
//     ทุก query ที่ไม่ควรเห็นหน้าที่ถูกลบต้องเขียน deleted_at IS NULL เอง
//     ของเดิมได้ฟรีจาก named query filter ของ EF — ตรงนี้คือของที่ "ถอยหลัง"
//     จึงรวมเงื่อนไขไว้ในค่าคงที่ตัวเดียว (LIVE) เพื่อให้ค้นหาและ review ได้ที่เดียว
// ═══════════════════════════════════════════════════════════════════════════

/** หน้าที่ยังไม่ถูกลบ — ดูคำเตือนหัวไฟล์ว่าทำไมต้องเขียนเองทุกครั้ง */
const LIVE = isNull(pages.deletedAt);

export interface PageRow {
  id: string;
  parentId: string | null;
  ancestorIds: string[];
  depth: number;
  rank: string;
  kind: PageKind;
  title: string;
  icon: string | null;
  coverUrl: string | null;
  status: PageStatus | null;
  accessRootId: string;
  lastEditedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PageNode {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  status: PageStatus | null;
  rank: string;
  depth: number;
  hasChildren: boolean;
  accessRootId: string;
  lastEditedBy: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MoveSubtreeCommand {
  pageId: string;
  newParentId: string | null;
  newAncestorIds: string[];
  oldDepth: number;
  newRank: string;
  oldAccessRootId: string;
  newAccessRootId: string;
}

/** ⚠️ ชื่อ field เป็นสัญญากับ client เดิม (ดู scripts/smoke-test.mjs) ห้ามเปลี่ยนลอย ๆ */
export interface TreeConsistency {
  badAncestors: number;
  badAccessRoots: number;
  orphans: number;
}

function db() {
  const session = currentSession();
  if (!session) throw new Error('เรียก repository นอก DbService.withScope()');
  return session.db;
}

const PAGE_COLUMNS = {
  id: pages.id,
  parentId: pages.parentId,
  ancestorIds: pages.ancestorIds,
  depth: pages.depth,
  rank: pages.rank,
  kind: pages.kind,
  title: pages.title,
  icon: pages.icon,
  coverUrl: pages.coverUrl,
  status: pages.status,
  accessRootId: pages.accessRootId,
  lastEditedBy: pages.lastEditedBy,
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
  deletedAt: pages.deletedAt,
};

@Injectable()
export class PageRepository {
  async get(pageId: string): Promise<PageRow | null> {
    const [row] = await db()
      .select(PAGE_COLUMNS)
      .from(pages)
      .where(and(eq(pages.id, pageId), LIVE))
      .limit(1);

    return (row as PageRow | undefined) ?? null;
  }

  /** ⚠️ เห็นหน้าที่อยู่ในถังขยะด้วย — ใช้เฉพาะ restore/purge ที่ต้องการแบบนั้นจริง */
  async getIncludingDeleted(pageId: string): Promise<PageRow | null> {
    const [row] = await db().select(PAGE_COLUMNS).from(pages).where(eq(pages.id, pageId)).limit(1);
    return (row as PageRow | undefined) ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────
  //  อ่าน tree
  //
  //  ⚠️ ORDER BY rank, id เสมอ — rank ชนกันได้เมื่อสอง client แทรกที่เดียวกัน
  //     พร้อมกัน id เป็นตัวตัดสินที่ทุก client เห็นตรงกัน
  //     (คอลัมน์ rank เป็น COLLATE "C" ฐานจึงเรียงแบบ byte order ให้เอง ซึ่ง
  //      ตรงกับที่ fractional-index.ts คำนวณ)
  // ─────────────────────────────────────────────────────────────────────
  listTree(): Promise<PageNode[]> {
    return db()
      .select(NODE_COLUMNS)
      .from(pages)
      // แถวของ database ไม่โผล่ใน sidebar
      .where(and(isNull(pages.databaseId), LIVE))
      .orderBy(asc(pages.depth), asc(pages.rank), asc(pages.id)) as Promise<PageNode[]>;
  }

  listTrash(): Promise<PageNode[]> {
    return db()
      .select({ ...NODE_COLUMNS, hasChildren: sql<boolean>`false` })
      .from(pages)
      .where(isNotNull(pages.deletedAt))
      .orderBy(desc(pages.deletedAt)) as Promise<PageNode[]>;
  }

  /**
   * rank ของเพื่อนบ้านที่จะแทรกระหว่างกลาง
   *
   * afterPageId = null → ต่อท้าย · ระบุหน้าที่ไม่ได้อยู่ในกลุ่มพี่น้องนี้ → ต่อท้ายเช่นกัน
   */
  async neighbourRanks(
    parentId: string | null,
    afterPageId: string | null,
  ): Promise<{ before: string | null; after: string | null }> {
    const siblings = await db()
      .select({ id: pages.id, rank: pages.rank })
      .from(pages)
      .where(and(parentId === null ? isNull(pages.parentId) : eq(pages.parentId, parentId), LIVE))
      .orderBy(asc(pages.rank), asc(pages.id));

    if (siblings.length === 0) return { before: null, after: null };

    const last = siblings.at(-1)!.rank;
    if (afterPageId === null) return { before: last, after: null };

    const index = siblings.findIndex((s) => s.id === afterPageId);
    if (index < 0) return { before: last, after: null };

    return {
      before: siblings[index]!.rank,
      after: index + 1 < siblings.length ? siblings[index + 1]!.rank : null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  สร้างหน้า — สี่แถวที่ต้องเกิดพร้อมกัน
  //
  //  ⚠️ ธุรกรรมครอบทั้ง request อยู่แล้ว (RequestContextInterceptor) จึงไม่ต้อง
  //     เปิดเอง — ต่างจากฝั่ง .NET ที่ repository ต้องเรียก InTransactionAsync
  //     เองทุกที่ที่เขียนมากกว่าหนึ่งตาราง
  //
  //  ⚠️ แถวใน page_searches ถูกสร้างที่นี่โดยเจตนา
  //
  //     ก่อนหน้านี้แถวนั้นเกิดเมื่อเบราว์เซอร์ POST /projection เท่านั้น (หลัง
  //     ผู้ใช้หยุดพิมพ์ 2 วินาที) แปลว่าหน้าที่ AI สร้างและยังไม่มีใครเปิด
  //     "ไม่มีแถวใน page_searches เลย" — ไม่ใช่แถวที่ล้าสมัย แต่ไม่มีอยู่
  //     ผลคือการค้นหาจะไม่เจอผลงานของ AI เองตลอดไป
  // ═══════════════════════════════════════════════════════════════════════
  async create(input: {
    page: {
      id: string;
      workspaceId: string;
      parentId: string | null;
      ancestorIds: string[];
      depth: number;
      rank: string;
      title: string;
      icon: string | null;
      status: string | null;
      accessRootId: string;
      createdBy: string;
    };
    acl: { role: string; grantedBy: string } | null;
    activity: ActivityRow;
  }): Promise<PageRow> {
    const [row] = await db()
      .insert(pages)
      .values({
        ...input.page,
        kind: 'page',
        lastEditedBy: input.page.createdBy,
      })
      .returning(PAGE_COLUMNS);

    if (!row) throw new Error('INSERT pages ไม่คืนแถว');

    if (input.acl) {
      await db().insert(pageAcls).values({
        workspaceId: input.page.workspaceId,
        pageId: input.page.id,
        subjectType: 'workspace',
        // uuid ว่าง = grant ระดับ workspace (บังคับด้วย ck_page_acls_subject_id)
        subjectId: EMPTY_UUID,
        role: input.acl.role,
        grantedBy: input.acl.grantedBy,
      });
    }

    await db().insert(pageSearches).values({
      pageId: input.page.id,
      workspaceId: input.page.workspaceId,
      accessRootId: input.page.accessRootId,
      title: input.page.title,
      bodyText: '',
    });

    await this.writeActivity(input.activity);

    return row as PageRow;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  แก้ field เดียว
  //
  //  ทั้งสามตัวเซ็ต last_edited_by ด้วยเสมอ
  //  ⚠️ ของเดิม UpdateIcon ลืมเซ็ต ต่างจากอีกสองตัว ผลคือแก้ไอคอนแล้ว
  //     updated_at ขยับแต่ last_edited_by ยังเป็นคนก่อนหน้า = ประวัติที่โกหก
  //     แบบเงียบ ๆ ซึ่งแย่กว่าไม่มีประวัติเลย
  // ═══════════════════════════════════════════════════════════════════════

  async updateTitle(pageId: string, title: string, editorId: string, activity: ActivityRow): Promise<void> {
    await db()
      .update(pages)
      .set({ title, lastEditedBy: editorId, updatedAt: sql`now()` })
      .where(and(eq(pages.id, pageId), LIVE));

    // page_searches.title เป็น projection ของค่านี้ — ถ้าไม่อัปเดตตาม การค้นหา
    // จะยังเจอชื่อเก่าจนกว่าเบราว์เซอร์จะส่ง projection รอบถัดไป
    await db().update(pageSearches).set({ title, updatedAt: sql`now()` }).where(eq(pageSearches.pageId, pageId));

    await this.writeActivity(activity);
  }

  /**
   * เปลี่ยนชื่อโดยไม่เขียนประวัติ — ใช้กับ autosave ของเบราว์เซอร์เท่านั้น
   *
   * ⚠️ ไม่ใช่ทางลัดของ updateTitle: title ที่มาจาก projection คือ "บรรทัดแรก
   *    ของเอกสาร" ซึ่งเปลี่ยนไปเรื่อย ๆ ระหว่างพิมพ์ประโยคแรก ถ้าบันทึกประวัติ
   *    ทุกครั้ง ฟีดกิจกรรมจะถูกกลบด้วยการเปลี่ยนชื่อทีละตัวอักษรจนมองไม่เห็น
   *    สิ่งที่ AI ทำ ซึ่งเป็นเหตุผลที่ฟีดมีอยู่
   *
   * ⚠️ **ห้ามแตะ lastEditedBy ที่นี่** — เคยตั้งไว้แล้วให้ผลผิด: การ sync ชื่อ
   *    เกิดจาก "เบราว์เซอร์ตัวไหนก็ได้ที่เปิดหน้านั้นอยู่" ไม่ใช่การพิมพ์ของคน
   *    หน้าที่ AI เขียนผ่าน MCP มี pages.title เป็นชื่อตอนสร้าง ส่วนบรรทัดแรก
   *    ในเอกสารคือหัวเรื่องที่ AI เขียน — สองค่านี้ต่างกัน คนแรกที่เปิดหน้าจึง
   *    ทำให้ระบบบันทึกว่า "เขาเป็นคนแก้ล่าสุด" ทั้งที่แค่เปิดดู
   *    ตัวที่กำหนดคนแก้จริงคือ markEdited() ซึ่งเรียกจากทางเขียนเนื้อหา
   */
  async updateTitleSilently(pageId: string, title: string): Promise<void> {
    await db()
      .update(pages)
      .set({ title, updatedAt: sql`now()` })
      .where(and(eq(pages.id, pageId), LIVE));
  }

  /**
   * บันทึกว่าใครแก้เนื้อหาหน้านี้ล่าสุด — เรียกจากทางเขียน Yjs update เท่านั้น
   *
   * ⚠️ ไม่เขียน activity โดยเจตนา: การพิมพ์หนึ่งประโยคสร้าง update หลายสิบก้อน
   *    ฟีดกิจกรรมมีไว้บันทึก "การกระทำ" (เปลี่ยนสถานะ ย้าย ลบ) ไม่ใช่ทุก keystroke
   */
  async markEdited(pageId: string, editorId: string): Promise<void> {
    await db()
      .update(pages)
      .set({ lastEditedBy: editorId, updatedAt: sql`now()` })
      .where(and(eq(pages.id, pageId), LIVE));
  }

  async updateIcon(
    pageId: string,
    icon: string | null,
    coverUrl: string | null,
    editorId: string,
    activity: ActivityRow,
  ): Promise<void> {
    await db()
      .update(pages)
      .set({ icon, coverUrl, lastEditedBy: editorId, updatedAt: sql`now()` })
      .where(and(eq(pages.id, pageId), LIVE));

    await this.writeActivity(activity);
  }

  async updateStatus(
    pageId: string,
    status: string | null,
    editorId: string,
    activity: ActivityRow | null,
  ): Promise<void> {
    await db()
      .update(pages)
      .set({ status, lastEditedBy: editorId, updatedAt: sql`now()` })
      .where(and(eq(pages.id, pageId), LIVE));

    if (activity) await this.writeActivity(activity);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ย้าย subtree — UPDATE เดียวสำหรับลูกหลานทั้งหมด
  //
  //  หัวใจอยู่ที่ `ancestor_ids @> ARRAY[$pageId]` ซึ่งวิ่งบน GIN index ทำให้
  //  ย้ายหน้าที่มีลูกหลาน 500 หน้าเป็น statement เดียว ไม่ใช่ recursion
  //
  //  การตัดสตริง: ลูกหลานมี ancestor_ids = [บรรพบุรุษเดิมของหน้าที่ย้าย …,
  //  หน้าที่ย้าย, …ต่อไป] เราแทนที่ "ส่วนหน้า" ที่ยาวเท่ากับ depth เดิมด้วยชุดใหม่
  //  แล้วเก็บส่วนที่เหลือ (ซึ่งเริ่มด้วยตัวหน้าที่ย้ายเอง) ไว้
  // ═══════════════════════════════════════════════════════════════════════
  async moveSubtree(
    command: MoveSubtreeCommand,
    aclToAdd: { workspaceId: string; role: string; grantedBy: string } | null,
    activity: ActivityRow,
  ): Promise<number> {
    // ─────────────────────────────────────────────────────────────────
    //  ⚠️ ACL ต้องเกิดในธุรกรรมเดียวกับการย้าย
    //
    //  ของเดิม service เคยเรียก AddAclAsync ก่อนแล้วค่อยย้าย ซึ่ง commit ทันที
    //  ถ้าการย้ายล้มหลังจากนั้น จะเหลือ ACL แบบ workspace-wide editor ค้างอยู่
    //  บนหน้าที่ "ไม่ได้ย้าย" — หน้านั้นกลายเป็น access root ที่ให้สิทธิ์แก้กับ
    //  ทุกคนใน workspace โดยไม่มีใครสั่ง เป็นการมอบสิทธิ์เงียบ ๆ ไม่ใช่แค่แถวขยะ
    //  และ AI ที่ retry การย้ายที่ล้มจะสร้างมันซ้ำได้เรื่อย ๆ
    //
    //  ตอนนี้ธุรกรรมครอบทั้ง request อยู่แล้ว ปัญหานี้จึงหมดไปโดยโครงสร้าง
    // ─────────────────────────────────────────────────────────────────
    if (aclToAdd) {
      await db().insert(pageAcls).values({
        workspaceId: aclToAdd.workspaceId,
        pageId: command.pageId,
        subjectType: 'workspace',
        subjectId: EMPTY_UUID,
        role: aclToAdd.role,
        grantedBy: aclToAdd.grantedBy,
      });
    }

    await this.writeActivity(activity);

    // ⚠️ sql.param() ไม่ใช่ของประดับ — template ของ drizzle "กระจาย" array ที่
    //    interpolate ตรง ๆ ออกเป็นหลายพารามิเตอร์คั่นด้วยจุลภาค (สำหรับ IN (...))
    //    ผลคือ ['a'] กลายเป็น 'a' เฉย ๆ แล้ว Postgres ตอบ "malformed array literal"
    //    ส่วน ['a','b'] จะกลายเป็น 'a','b' ซึ่ง **ไม่ error** แต่ได้ค่าผิด
    const newAncestors = sql`${sql.param(command.newAncestorIds)}::uuid[]`;

    // 1) ตัวหน้าที่ถูกย้ายเอง
    await db().execute(sql`
      UPDATE pages
         SET parent_id      = ${command.newParentId},
             ancestor_ids   = ${newAncestors},
             depth          = cardinality(${newAncestors}),
             rank           = ${command.newRank},
             access_root_id = ${command.newAccessRootId},
             updated_at     = now()
       WHERE id = ${command.pageId}
    `);

    // 2) ลูกหลานทั้งหมด — statement เดียว
    const result = await db().execute(sql`
      UPDATE pages
         SET ancestor_ids   = ${newAncestors} || ancestor_ids[${command.oldDepth} + 1 : ],
             depth          = depth + (cardinality(${newAncestors}) - ${command.oldDepth}),
             access_root_id = CASE
                                  WHEN access_root_id = ${command.oldAccessRootId}
                                  THEN ${command.newAccessRootId}
                                  ELSE access_root_id
                              END,
             updated_at     = now()
       WHERE ancestor_ids @> ARRAY[${command.pageId}]::uuid[]
    `);

    // access_root_id ของแถวใน page_searches ต้องตามไปด้วย ไม่งั้นการกรองสิทธิ์
    // ตอนค้นหาจะใช้ root เดิมที่ผู้ใช้อาจไม่มีสิทธิ์แล้ว
    await db().execute(sql`
      UPDATE page_searches s
         SET access_root_id = p.access_root_id
        FROM pages p
       WHERE p.id = s.page_id
         AND s.access_root_id IS DISTINCT FROM p.access_root_id
    `);

    return result.rowCount ?? 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ลบ / กู้คืน — ทำกับ subtree ทั้งก้อนเสมอ
  // ═══════════════════════════════════════════════════════════════════════

  async softDeleteSubtree(pageId: string, activity: ActivityRow): Promise<number> {
    const result = await db().execute(sql`
      UPDATE pages
         SET deleted_at = now(), updated_at = now()
       WHERE deleted_at IS NULL
         AND (id = ${pageId} OR ancestor_ids @> ARRAY[${pageId}]::uuid[])
    `);

    await this.writeActivity(activity);
    return result.rowCount ?? 0;
  }

  async restoreSubtree(pageId: string, activity: ActivityRow): Promise<number> {
    const result = await db().execute(sql`
      UPDATE pages
         SET deleted_at = NULL, updated_at = now()
       WHERE deleted_at IS NOT NULL
         AND (id = ${pageId} OR ancestor_ids @> ARRAY[${pageId}]::uuid[])
    `);

    await this.writeActivity(activity);
    return result.rowCount ?? 0;
  }

  /**
   * ลบถาวร — page_doc_updates / page_doc_snapshots / page_searches / page_notes
   * หายตามด้วย ON DELETE CASCADE ของ composite FK
   *
   * ⚠️ activity_logs ไม่หายตาม (ON DELETE SET NULL เฉพาะ page_id) โดยเจตนา —
   *    เป็นการเก็บหลักฐานไว้ตอบว่า "ใครลบหน้าชื่ออะไร" ดู sql/objects.sql
   */
  async purgeSubtree(pageId: string): Promise<number> {
    const result = await db().execute(sql`
      DELETE FROM pages
       WHERE id = ${pageId} OR ancestor_ids @> ARRAY[${pageId}]::uuid[]
    `);

    return result.rowCount ?? 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ACL
  // ═══════════════════════════════════════════════════════════════════════

  async hasOwnAcl(pageId: string): Promise<boolean> {
    const [row] = await db()
      .select({ one: sql<number>`1` })
      .from(pageAcls)
      .where(eq(pageAcls.pageId, pageId))
      .limit(1);

    return row !== undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Repair
  //
  //  ancestor_ids และ access_root_id เป็นค่า denormalise ที่ "เพี้ยนได้"
  //  โดยเฉพาะ access_root_id ซึ่งถ้าเพี้ยนแปลว่าเป็นบั๊กเรื่องสิทธิ์ จึงต้องมี
  //  ทางซ่อมและทางตรวจตั้งแต่วันแรก ไม่ใช่ไปเขียนตอนเกิดเรื่อง
  // ═══════════════════════════════════════════════════════════════════════

  /** parent_id คือความจริง (มี FK บังคับ) — สร้าง ancestor_ids ใหม่จากมัน */
  async rebuildAncestorIds(): Promise<number> {
    const result = await db().execute(sql`
      WITH RECURSIVE tree AS (
          SELECT id, ARRAY[]::uuid[] AS ancestors, 0 AS depth
            FROM pages
           WHERE parent_id IS NULL
          UNION ALL
          SELECT p.id, t.ancestors || p.parent_id, t.depth + 1
            FROM pages p
            JOIN tree t ON p.parent_id = t.id
      )
      UPDATE pages
         SET ancestor_ids = t.ancestors, depth = t.depth
        FROM tree t
       WHERE pages.id = t.id
         AND (pages.ancestor_ids IS DISTINCT FROM t.ancestors
              OR pages.depth IS DISTINCT FROM t.depth)
    `);

    return result.rowCount ?? 0;
  }

  /**
   * access root = ancestor-or-self ที่ใกล้ที่สุดซึ่งมีแถวใน page_acls
   * ancestor_ids เรียงจาก root ไป parent จึงเอา ordinal มากสุดที่มี ACL
   */
  async recomputeAccessRoots(): Promise<number> {
    const result = await db().execute(sql`
      WITH acl_owner AS (
          SELECT DISTINCT page_id FROM page_acls
      ),
      resolved AS (
          SELECT p.id,
                 COALESCE(
                     (SELECT p.id WHERE EXISTS (
                          SELECT 1 FROM acl_owner o WHERE o.page_id = p.id)),
                     (SELECT u.a
                        FROM unnest(p.ancestor_ids) WITH ORDINALITY AS u(a, ord)
                        JOIN acl_owner o ON o.page_id = u.a
                       ORDER BY u.ord DESC
                       LIMIT 1),
                     p.ancestor_ids[1],
                     p.id
                 ) AS access_root_id
            FROM pages p
      )
      UPDATE pages
         SET access_root_id = r.access_root_id
        FROM resolved r
       WHERE pages.id = r.id
         AND pages.access_root_id IS DISTINCT FROM r.access_root_id
    `);

    return result.rowCount ?? 0;
  }

  async checkConsistency(): Promise<TreeConsistency> {
    const result = await db().execute(sql`
      WITH RECURSIVE tree AS (
          SELECT id, ARRAY[]::uuid[] AS ancestors, 0 AS depth
            FROM pages WHERE parent_id IS NULL
          UNION ALL
          SELECT p.id, t.ancestors || p.parent_id, t.depth + 1
            FROM pages p JOIN tree t ON p.parent_id = t.id
      ),
      acl_owner AS (
          SELECT DISTINCT page_id FROM page_acls
      ),
      expected_root AS (
          SELECT p.id,
                 COALESCE(
                     (SELECT p.id WHERE EXISTS (
                          SELECT 1 FROM acl_owner o WHERE o.page_id = p.id)),
                     (SELECT u.a FROM unnest(p.ancestor_ids) WITH ORDINALITY AS u(a, ord)
                        JOIN acl_owner o ON o.page_id = u.a
                       ORDER BY u.ord DESC LIMIT 1),
                     p.ancestor_ids[1],
                     p.id
                 ) AS root
            FROM pages p
      )
      SELECT
          (SELECT count(*) FROM pages p JOIN tree t ON t.id = p.id
            WHERE p.ancestor_ids IS DISTINCT FROM t.ancestors
               OR p.depth IS DISTINCT FROM t.depth)::int AS bad_ancestors,
          (SELECT count(*) FROM pages p JOIN expected_root e ON e.id = p.id
            WHERE p.access_root_id IS DISTINCT FROM e.root)::int AS bad_access_roots,
          (SELECT count(*) FROM pages p
            WHERE p.parent_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM tree t WHERE t.id = p.id))::int AS orphans
    `);

    const row = result.rows[0] as
      | { bad_ancestors: number; bad_access_roots: number; orphans: number }
      | undefined;

    return {
      badAncestors: row?.bad_ancestors ?? 0,
      badAccessRoots: row?.bad_access_roots ?? 0,
      orphans: row?.orphans ?? 0,
    };
  }

  private async writeActivity(activity: ActivityRow): Promise<void> {
    await db().insert(activityLogs).values(activity);
  }
}

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

const NODE_COLUMNS = {
  id: pages.id,
  parentId: pages.parentId,
  title: pages.title,
  icon: pages.icon,
  status: pages.status,
  rank: pages.rank,
  depth: pages.depth,
  accessRootId: pages.accessRootId,
  lastEditedBy: pages.lastEditedBy,
  updatedAt: pages.updatedAt,
  deletedAt: pages.deletedAt,
  hasChildren: sql<boolean>`EXISTS (
    SELECT 1 FROM pages c WHERE c.parent_id = ${pages.id} AND c.deleted_at IS NULL
  )`,
};
