import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { currentSession } from '../db/db.service.js';

// ═══════════════════════════════════════════════════════════════════════════
//  SearchRepository — PGroonga
//
//  ต้องเป็น raw SQL: `&@~`, pgroonga_score() และ pgroonga_snippet_html()
//  ไม่มีทางเขียนผ่าน query builder ได้เลย
//
//  ── สิ่งที่เปลี่ยนไปจากฝั่ง .NET ──────────────────────────────────────────
//  ของเดิมมีคำเตือนว่า "raw SQL ไม่ผ่าน global query filter จึงต้องเขียนเงื่อนไข
//  เองครบทั้งสามชั้น: workspace_id (tenant), deleted_at (soft delete) และ
//  access_root_id (สิทธิ์) ลืมข้อใดข้อหนึ่ง = ข้อมูลรั่วโดยไม่มีอะไรฟ้อง"
//
//  ตอนนี้เหลือสองชั้นที่ต้องเขียนเอง — ชั้น tenant ถูก RLS บังคับให้แล้วทั้งกับ
//  raw SQL และ query builder ลืมไม่ได้เพราะมันไม่ได้อยู่ในมือเรา
//
//  ⚠️ อีกสองชั้นยังลืมได้อยู่ และผลก็ยังเหมือนเดิม — เทสใน test/search.spec.ts
//     ยิงทั้งสองกรณี (หน้าที่ถูกลบ · หน้าที่ไม่มีสิทธิ์เห็น)
// ═══════════════════════════════════════════════════════════════════════════

export interface SearchHit {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  status: string | null;
  snippet: string;
  score: number;
  updatedAt: string;
}

@Injectable()
export class SearchRepository {
  async search(input: {
    query: string;
    visibleAccessRoots: readonly string[];
    statuses: readonly string[];
    limit: number;
  }): Promise<SearchHit[]> {
    const session = currentSession();
    if (!session) throw new Error('เรียก repository นอก DbService.withScope()');

    // ─────────────────────────────────────────────────────────────────────
    //  pgroonga_query_escape ทำให้คำค้นของผู้ใช้ถูกอ่านเป็นข้อความ ไม่ใช่ไวยากรณ์
    //
    //  `&@~` รับ query syntax ของ Groonga (`+ - ( ) " *` และ OR) ถ้าปล่อยคำค้น
    //  ดิบเข้าไป ผู้ใช้พิมพ์วงเล็บเดียวก็ทำให้ query throw ทั้งคำขอ — และ AI ที่
    //  ได้ error กลับไปมักลองซ้ำแบบเดิม ไม่ได้เดาว่าต้อง escape เอง
    //
    //  เลือก escape ด้วยฟังก์ชันของ PGroonga เองไม่ใช่เขียนกฎใน TypeScript
    //  เพราะกฎการ escape เป็นของ Groonga ถ้าลอกมาแล้วคลาดไปตัวเดียวจะได้ผลค้น
    //  ที่ผิดแบบเงียบ ๆ ไม่ใช่ error
    //
    //  ⚠️ มันไม่ escape คำว่า OR — ผู้ใช้พิมพ์ OR ยังได้ความหมาย OR อยู่
    //     ยอมรับได้ เพราะมันไม่ทำให้ query พัง และเป็นพฤติกรรมที่อธิบายได้
    //
    //  ⚠️ ห้ามเรียงด้วย score เพียว ๆ — หน้าที่แก้ล่าสุดควรมาก่อนเมื่อคะแนนเท่ากัน
    //     และต้องมี id ปิดท้ายเพื่อให้ลำดับคงที่ (paging ในอนาคตต้องพึ่งข้อนี้)
    // ─────────────────────────────────────────────────────────────────────
    const result = await session.db.execute(sql`
      SELECT s.page_id                                        AS id,
             p.parent_id,
             p.title,
             p.icon,
             p.status,
             COALESCE(
                 (pgroonga_snippet_html(
                     s.body_text,
                     pgroonga_query_extract_keywords(pgroonga_query_escape(${input.query}))))[1],
                 '')                                          AS snippet,
             pgroonga_score(s.tableoid, s.ctid)               AS score,
             p.updated_at
        FROM page_searches s
        JOIN pages p
          ON p.workspace_id = s.workspace_id
         AND p.id = s.page_id
       WHERE s.access_root_id = ANY(${sql.param(input.visibleAccessRoots)}::uuid[])
         AND p.deleted_at IS NULL
         AND s.search_text &@~ pgroonga_query_escape(${input.query})
         AND (cardinality(${sql.param(input.statuses)}::text[]) = 0
              OR p.status = ANY(${sql.param(input.statuses)}::text[]))
       ORDER BY score DESC, p.updated_at DESC, s.page_id
       LIMIT ${input.limit}
    `);

    return result.rows.map((row) => {
      const r = row as {
        id: string;
        parent_id: string | null;
        title: string;
        icon: string | null;
        status: string | null;
        snippet: string;
        score: number | string;
        updated_at: string;
      };

      return {
        id: r.id,
        parentId: r.parent_id,
        title: r.title,
        icon: r.icon,
        status: r.status,
        snippet: r.snippet,
        score: Number(r.score),
        updatedAt: r.updated_at,
      };
    });
  }
}
