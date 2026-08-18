import { Injectable, Logger } from '@nestjs/common';

import { SearchRepository, type SearchHit } from './search.repository.js';
import { requireRole } from '../common/request-context.js';
import { err, ok, type Result } from '../common/result.js';
import { isWorkspaceWideEditor, PAGE_STATUSES } from '../domain/roles.js';
import { PageRepository } from '../pages/page.repository.js';
import { PermissionService } from '../pages/permission.service.js';

// ═══════════════════════════════════════════════════════════════════════════
//  SearchService
//
//  กรองสิทธิ์ด้วย "access root ที่มองเห็นได้" ในคิวรีเดียว ไม่ใช่กรองผลลัพธ์ทีหลัง
//  — การกรองทีหลังทำให้ LIMIT ผิด (ตัดก่อนกรอง แล้วได้ผลน้อยกว่าที่ควร) และทำให้
//  จำนวนผลที่บอกผู้ใช้ไม่ตรงกับที่เห็น
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** คำค้นสั้นกว่านี้กับ bigram index จะกวาดเกือบทุกแถว */
const MIN_QUERY_LENGTH = 2;

export interface SearchResultDto {
  query: string;
  count: number;
  /**
   * true = ผลลัพธ์ถูกตัดที่ limit อาจมีมากกว่านี้
   *
   * บอกไปตรง ๆ เพราะการตัดผลลัพธ์เงียบ ๆ ทำให้ผู้เรียก (โดยเฉพาะ AI) สรุปว่า
   * "ค้นแล้วเจอเท่านี้" ทั้งที่ยังมีอีก
   */
  truncated: boolean;
  hits: SearchHit[];
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly search: SearchRepository,
    private readonly permissions: PermissionService,
    private readonly pages: PageRepository,
  ) {}

  async run(query: string, status?: string, limit?: number): Promise<Result<SearchResultDto>> {
    const trimmed = (query ?? '').trim();

    // ─────────────────────────────────────────────────────────────────────
    //  คำค้นสั้นเกินไป — ปฏิเสธ ไม่ใช่คืนทุกอย่าง
    //
    //  index เป็น bigram (n=2) คำเดียวตัวอักษรเดียวจึงตรงกับแทบทุกแถว ซึ่งทั้ง
    //  ช้าและไม่มีประโยชน์ต่อผู้ค้น
    // ─────────────────────────────────────────────────────────────────────
    if (trimmed.length < MIN_QUERY_LENGTH) {
      return err.validation(`คำค้นต้องยาวอย่างน้อย ${MIN_QUERY_LENGTH} ตัวอักษร`, 'query_too_short');
    }

    let statuses: string[] = [];

    if (status !== undefined && status.trim() !== '') {
      const normalised = status.trim().toLowerCase();

      if (!(PAGE_STATUSES as readonly string[]).includes(normalised)) {
        return err.validation(`สถานะต้องเป็นหนึ่งใน: ${PAGE_STATUSES.join(', ')}`, 'invalid_status');
      }

      statuses = [normalised];
    }

    const roots = await this.visibleRoots();

    // ไม่มี access root ที่เห็นได้เลย = ไม่มีอะไรให้ค้น ไม่ต้องยิงคิวรี
    if (roots.length === 0) return ok({ query: trimmed, count: 0, truncated: false, hits: [] });

    // ขอเกินมาหนึ่งแถวเพื่อรู้ว่ามีมากกว่า limit จริงไหม โดยไม่ต้อง COUNT(*) ซ้ำ
    // อีกรอบ — COUNT บน PGroonga ที่มีสิทธิ์กรองอยู่ด้วยแพงกว่าที่คุ้ม
    const effectiveLimit = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const hits = await this.search.search({
      query: trimmed,
      visibleAccessRoots: roots,
      statuses,
      limit: effectiveLimit + 1,
    });

    const truncated = hits.length > effectiveLimit;
    if (truncated) hits.pop();

    this.logger.log(
      `ค้นหา "${trimmed}" — เจอ ${hits.length} หน้า (ตัดที่ ${effectiveLimit}: ${truncated})`,
    );

    return ok({ query: trimmed, count: hits.length, truncated, hits });
  }

  /**
   * ⚠️ owner/admin เห็นทุกหน้า แต่ "ทุกหน้า" ในรูปของ access root ไม่ได้มาจาก
   *    page_acls เสมอ — หน้าที่ไม่มี ACL ของตัวเองจะชี้ไป root ของบรรพบุรุษ
   *    ซึ่งอยู่ใน page_acls อยู่แล้ว จึงใช้ชุดเดียวกันได้
   *
   *    แต่ถ้า access root เพี้ยน (ชี้ไปหน้าที่ไม่มี ACL) หน้านั้นจะหายจากผลค้นหา
   *    ของ owner ด้วย — จึงอ่านจาก tree แทนสำหรับ owner/admin ซึ่งตรงกับสิ่งที่
   *    พวกเขาเห็นใน sidebar เป๊ะ ๆ
   */
  private async visibleRoots(): Promise<string[]> {
    if (!isWorkspaceWideEditor(requireRole())) {
      return [...(await this.permissions.visibleAccessRoots())];
    }

    const tree = await this.pages.listTree();
    return [...new Set(tree.map((n) => n.accessRootId))];
  }
}
