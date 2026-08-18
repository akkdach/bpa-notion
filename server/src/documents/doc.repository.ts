import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, lte, notInArray, sql } from 'drizzle-orm';

import { currentSession } from '../db/db.service.js';
import {
  pageDocSnapshots,
  pageDocUpdates,
  pageLinks,
  pages,
  pageSearches,
} from '../db/schema.js';

// ═══════════════════════════════════════════════════════════════════════════
//  DocRepository — เก็บ Yjs update เป็น bytea
//
//  ⚠️ ชั้นนี้ยัง "ไม่แกะ" ก้อนไบต์เลย เหมือนฝั่ง .NET — การแกะเกิดที่
//     blocknote.ts เท่านั้น และเฉพาะตอนที่เซิร์ฟเวอร์ต้องเขียนเนื้อหาจริง ๆ
//     (AI ต่อท้ายหน้า) ทางอ่าน/เขียนของเบราว์เซอร์ยังส่งผ่านแบบทึบทั้งหมด
// ═══════════════════════════════════════════════════════════════════════════

/** เก็บ snapshot ไว้กี่รุ่น — เผื่อไว้กู้เมื่อ client ส่ง snapshot ที่ข้อมูลหาย */
const SNAPSHOT_GENERATIONS_TO_KEEP = 3;

export interface DocumentState {
  snapshot: Uint8Array | null;
  snapshotUpToSeq: number;
  updates: Uint8Array[];
  headSeq: number;
}

export interface DocumentStats {
  headSeq: number;
  snapshotUpToSeq: number;
  updatesSinceSnapshot: number;
  snapshotByteSize: number;
}

export interface SnapshotRow {
  id: number;
  upToSeq: number;
  byteSize: number;
}

export interface SearchProjection {
  title: string;
  bodyText: string;
  updatedAt: string;
}

export interface BacklinkSource {
  id: string;
  title: string;
  icon: string | null;
  updatedAt: string;
}

function db() {
  const session = currentSession();
  if (!session) throw new Error('เรียก repository นอก DbService.withScope()');
  return session.db;
}

@Injectable()
export class DocRepository {
  private readonly logger = new Logger(DocRepository.name);

  // ═══════════════════════════════════════════════════════════════════════
  //  อ่านสถานะเอกสาร — statement เดียว ไม่ใช่สามคำสั่ง
  //
  //  ⚠️ นี่คือ "การอ่านที่ขาดตอนไม่ได้" ไม่ใช่การรวบให้เร็วขึ้น
  //
  //     ถ้าอ่าน snapshot ก่อน แล้ว client อื่น compact ทันก่อนเราจะอ่าน update
  //     เราจะได้ snapshot เก่า + update ที่ถูก prune ไปบางส่วน = เอกสารมีรู
  //     ที่กู้ไม่ได้ และไม่มีอะไรส่งเสียง
  //
  //     ฝั่ง .NET แก้ด้วยการเปิดธุรกรรม REPEATABLE READ ครอบสามคำสั่ง ที่นี่
  //     ใช้ statement เดียวแทน ซึ่งได้ผลเท่ากันโดยไม่ต้องยก isolation level
  //     ของทั้ง request ขึ้น (RR ทำให้ต้องมี retry เมื่อชนกัน — ราคาที่ไม่
  //     จำเป็นต้องจ่ายสำหรับการอ่านครั้งเดียว)
  //
  //     คำสั่งเดียวใน Postgres เห็น MVCC snapshot เดียวเสมอ แม้ที่ READ
  //     COMMITTED ซึ่งเป็น default
  // ═══════════════════════════════════════════════════════════════════════
  async readState(pageId: string): Promise<DocumentState> {
    // ⚠️ is_trusted เท่านั้น — snapshot ที่เล็กลงผิดปกติถูกเก็บไว้แต่ห้ามใช้เสิร์ฟ
    //    ไม่งั้นข้อมูลจะ "หาย" จากมุมผู้ใช้ทั้งที่ยังอยู่ในฐาน
    const result = await db().execute(sql`
      WITH snap AS (
          SELECT snapshot, up_to_seq
            FROM page_doc_snapshots
           WHERE page_id = ${pageId} AND is_trusted
           ORDER BY up_to_seq DESC
           LIMIT 1
      )
      SELECT (SELECT snapshot FROM snap)                        AS snapshot,
             coalesce((SELECT up_to_seq FROM snap), 0)::int8    AS up_to_seq,
             coalesce((SELECT array_agg(update_data ORDER BY seq)
                         FROM page_doc_updates
                        WHERE page_id = ${pageId}
                          AND seq > coalesce((SELECT up_to_seq FROM snap), 0)),
                      ARRAY[]::bytea[])                         AS updates,
             coalesce((SELECT max(seq) FROM page_doc_updates
                        WHERE page_id = ${pageId}), 0)::int8    AS head_seq
    `);

    const row = result.rows[0] as
      | { snapshot: Buffer | null; up_to_seq: number; updates: Buffer[]; head_seq: number }
      | undefined;

    if (!row) return { snapshot: null, snapshotUpToSeq: 0, updates: [], headSeq: 0 };

    return {
      snapshot: row.snapshot ? new Uint8Array(row.snapshot) : null,
      snapshotUpToSeq: Number(row.up_to_seq),
      updates: row.updates.map((u) => new Uint8Array(u)),
      headSeq: Number(row.head_seq) || Number(row.up_to_seq),
    };
  }

  /** update ทั้งหมดที่ประกอบเป็นเอกสาร เรียงตามลำดับที่ต้อง apply */
  async readFrames(pageId: string): Promise<Uint8Array[]> {
    const state = await this.readState(pageId);
    return state.snapshot ? [state.snapshot, ...state.updates] : state.updates;
  }

  async appendUpdate(input: {
    workspaceId: string;
    pageId: string;
    update: Uint8Array;
    yClientId: number | null;
    authorUserId: string;
  }): Promise<number> {
    const [row] = await db()
      .insert(pageDocUpdates)
      .values({
        workspaceId: input.workspaceId,
        pageId: input.pageId,
        updateData: Buffer.from(input.update),
        yClientId: input.yClientId,
        authorUserId: input.authorUserId,
      })
      .returning({ seq: pageDocUpdates.seq });

    if (!row) throw new Error('INSERT page_doc_updates ไม่คืนแถว');
    return row.seq;
  }

  async headSeq(pageId: string): Promise<number> {
    const [row] = await db()
      .select({ head: sql<number>`coalesce(max(${pageDocUpdates.seq}), 0)::int8` })
      .from(pageDocUpdates)
      .where(eq(pageDocUpdates.pageId, pageId));

    return row?.head ?? 0;
  }

  async stats(pageId: string): Promise<DocumentStats> {
    const [snapshot] = await db()
      .select({ upToSeq: pageDocSnapshots.upToSeq, byteSize: pageDocSnapshots.byteSize })
      .from(pageDocSnapshots)
      .where(eq(pageDocSnapshots.pageId, pageId))
      .orderBy(desc(pageDocSnapshots.upToSeq))
      .limit(1);

    const upTo = snapshot?.upToSeq ?? 0;

    const [counts] = await db()
      .select({
        head: sql<number>`coalesce(max(${pageDocUpdates.seq}), 0)::int8`,
        since: sql<number>`count(*) filter (where ${pageDocUpdates.seq} > ${upTo})::int`,
      })
      .from(pageDocUpdates)
      .where(eq(pageDocUpdates.pageId, pageId));

    return {
      headSeq: counts?.head || upTo,
      snapshotUpToSeq: upTo,
      updatesSinceSnapshot: counts?.since ?? 0,
      snapshotByteSize: snapshot?.byteSize ?? 0,
    };
  }

  latestSnapshot(pageId: string): Promise<SnapshotRow | undefined> {
    return this.latest(pageId, true);
  }

  latestUntrustedSnapshot(pageId: string): Promise<SnapshotRow | undefined> {
    return this.latest(pageId, false);
  }

  private async latest(pageId: string, trusted: boolean): Promise<SnapshotRow | undefined> {
    const [row] = await db()
      .select({
        id: pageDocSnapshots.id,
        upToSeq: pageDocSnapshots.upToSeq,
        byteSize: pageDocSnapshots.byteSize,
      })
      .from(pageDocSnapshots)
      .where(and(eq(pageDocSnapshots.pageId, pageId), eq(pageDocSnapshots.isTrusted, trusted)))
      .orderBy(desc(pageDocSnapshots.upToSeq))
      .limit(1);

    return row;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  บันทึก snapshot + prune
  //
  //  ⚠️ prune เฉพาะ update ที่ snapshot "รุ่นก่อนหน้า" ครอบคลุมแล้ว ไม่ใช่
  //     รุ่นล่าสุด — เก็บ update ไว้เกินหนึ่งรุ่นเสมอ
  //
  //  เหตุผล: snapshot มาจาก client ซึ่งอาจมีบั๊ก (ไม่ต้องถึงขั้นมุ่งร้าย — แค่
  //  snapshot เอกสารที่ตัวเองยังใช้ update ไม่ครบก็พอ) การเก็บ update ของรุ่น
  //  ล่าสุดไว้ทำให้ยัง rebuild จาก snapshot รุ่นก่อนได้อยู่
  // ═══════════════════════════════════════════════════════════════════════
  async saveSnapshotAndPrune(
    input: {
      workspaceId: string;
      pageId: string;
      snapshot: Uint8Array;
      upToSeq: number;
      isTrusted: boolean;
      createdBy: string;
    },
    allowPrune: boolean,
  ): Promise<number> {
    await db().insert(pageDocSnapshots).values({
      workspaceId: input.workspaceId,
      pageId: input.pageId,
      snapshot: Buffer.from(input.snapshot),
      upToSeq: input.upToSeq,
      byteSize: input.snapshot.length,
      isTrusted: input.isTrusted,
      createdBy: input.createdBy,
    });

    if (!allowPrune) return 0;

    // seq ที่ snapshot รุ่นก่อนหน้า (ลำดับที่สองจากล่าสุด) ครอบคลุม
    const previous = await db()
      .select({ upToSeq: pageDocSnapshots.upToSeq })
      .from(pageDocSnapshots)
      .where(and(eq(pageDocSnapshots.pageId, input.pageId), eq(pageDocSnapshots.isTrusted, true)))
      .orderBy(desc(pageDocSnapshots.upToSeq))
      .limit(1)
      .offset(1);

    let pruned = 0;

    if (previous[0]) {
      const removed = await db()
        .delete(pageDocUpdates)
        .where(
          and(eq(pageDocUpdates.pageId, input.pageId), lte(pageDocUpdates.seq, previous[0].upToSeq)),
        )
        .returning({ seq: pageDocUpdates.seq });

      pruned = removed.length;
    }

    // เก็บ snapshot ไว้ 3 รุ่น
    const keep = await db()
      .select({ id: pageDocSnapshots.id })
      .from(pageDocSnapshots)
      .where(and(eq(pageDocSnapshots.pageId, input.pageId), eq(pageDocSnapshots.isTrusted, true)))
      .orderBy(desc(pageDocSnapshots.upToSeq))
      .limit(SNAPSHOT_GENERATIONS_TO_KEEP);

    if (keep.length > 0) {
      await db()
        .delete(pageDocSnapshots)
        .where(
          and(
            eq(pageDocSnapshots.pageId, input.pageId),
            eq(pageDocSnapshots.isTrusted, true),
            notInArray(
              pageDocSnapshots.id,
              keep.map((k) => k.id),
            ),
          ),
        );
    }

    this.logger.log(
      `compact หน้า ${input.pageId} ถึง seq ${input.upToSeq} — ลบ update ${pruned} แถว`,
    );

    return pruned;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  projection สำหรับค้นหา — derived ทั้งหมด สร้างใหม่ได้เสมอ
  // ═══════════════════════════════════════════════════════════════════════

  async getProjection(pageId: string): Promise<SearchProjection | null> {
    const [row] = await db()
      .select({
        title: pageSearches.title,
        bodyText: pageSearches.bodyText,
        updatedAt: pageSearches.updatedAt,
      })
      .from(pageSearches)
      .where(eq(pageSearches.pageId, pageId))
      .limit(1);

    return row ?? null;
  }

  async upsertProjection(input: {
    workspaceId: string;
    pageId: string;
    accessRootId: string;
    title: string;
    bodyText: string;
  }): Promise<void> {
    await db()
      .insert(pageSearches)
      .values({
        pageId: input.pageId,
        workspaceId: input.workspaceId,
        accessRootId: input.accessRootId,
        title: input.title,
        bodyText: input.bodyText,
      })
      .onConflictDoUpdate({
        target: pageSearches.pageId,
        set: {
          accessRootId: input.accessRootId,
          title: input.title,
          bodyText: input.bodyText,
          updatedAt: sql`now()`,
        },
      });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ลิงก์ระหว่างหน้า (`@page` mention) — derived เหมือน projection
  // ═══════════════════════════════════════════════════════════════════════

  async replaceLinks(
    workspaceId: string,
    sourcePageId: string,
    targetPageIds: readonly string[],
  ): Promise<number> {
    // ─────────────────────────────────────────────────────────────────
    //  กรองเป้าหมายก่อนเขียน
    //
    //  ⚠️ ปล่อยให้ composite FK เป็นคนปฏิเสธไม่ได้ — FK violation จะทำให้
    //     ธุรกรรมทั้ง request ล้ม แปลว่า mention หน้าที่เพิ่งถูกลบไปหนึ่งอัน
    //     จะทำให้ projection ทั้งหน้าพัง รวมถึง title ที่ sidebar ใช้
    //
    //     FK ยังอยู่และยังเป็น backstop จริง — แต่ทางที่ถูกคือกรองก่อน ให้ FK
    //     ได้ทำหน้าที่ดักบั๊ก ไม่ใช่ดักข้อมูลที่ผู้ใช้ป้อนตามปกติ
    //
    //     ⚠️ ที่นี่ RLS กรอง workspace ให้แล้ว หน้าจาก workspace อื่นจึงหลุด
    //        ตะแกรงนี้ไปไม่ได้แม้ผู้เรียกจะรู้ id
    // ─────────────────────────────────────────────────────────────────
    const wanted = [...new Set(targetPageIds)].filter((id) => id !== sourcePageId);

    const valid =
      wanted.length === 0
        ? []
        : await db().select({ id: pages.id }).from(pages).where(inArray(pages.id, wanted));

    await db().delete(pageLinks).where(eq(pageLinks.sourcePageId, sourcePageId));

    if (valid.length > 0) {
      await db()
        .insert(pageLinks)
        .values(
          valid.map((v) => ({ workspaceId, sourcePageId, targetPageId: v.id })),
        );
    }

    return valid.length;
  }

  backlinks(targetPageId: string, limit: number): Promise<BacklinkSource[]> {
    return db()
      .select({
        id: pages.id,
        title: pages.title,
        icon: pages.icon,
        updatedAt: pages.updatedAt,
      })
      .from(pageLinks)
      .innerJoin(pages, eq(pages.id, pageLinks.sourcePageId))
      .where(eq(pageLinks.targetPageId, targetPageId))
      .orderBy(desc(pages.updatedAt))
      .limit(limit);
  }
}
