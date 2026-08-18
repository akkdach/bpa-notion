import { Injectable, Logger } from '@nestjs/common';

import {
  CollaborationRepository,
  type ActivityFeedRow,
  type NoteRow,
} from './collaboration.repository.js';
import type { ActivityFeedDto, AddNoteInput, NoteDto } from './collaboration.schema.js';
import { requireRole, requireUserId, requireWorkspaceId } from '../common/request-context.js';
import { err, ok, type Result } from '../common/result.js';
import { uuidv7 } from '../common/uuid.js';
import { ActivityAction, buildActivity } from '../domain/activity.js';
import { canComment, isWorkspaceWideEditor, type UserKind } from '../domain/roles.js';
import { PageRepository } from '../pages/page.repository.js';
import { PermissionService } from '../pages/permission.service.js';

// ═══════════════════════════════════════════════════════════════════════════
//  CollaborationService — บันทึกบนหน้า + ฟีดกิจกรรม
//
//  สองเรื่องนี้อยู่ service เดียวกันเพราะทำหน้าที่เดียวกัน: ทำให้เจ้าของตรวจงาน
//  ที่ AI ทำได้ อันหนึ่งคือสิ่งที่ AI "เล่า" อีกอันคือสิ่งที่ระบบ "บันทึกไว้เอง"
// ═══════════════════════════════════════════════════════════════════════════

const NOTE_LIMIT = 200;
const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_ACTIVITY_LIMIT = 200;

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(
    private readonly repo: CollaborationRepository,
    private readonly pages: PageRepository,
    private readonly permissions: PermissionService,
  ) {}

  async addNote(pageId: string, input: AddNoteInput): Promise<Result<NoteDto>> {
    const body = input.body.trim();

    // ─────────────────────────────────────────────────────────────────────
    //  ⚠️ canComment ไม่ใช่ canEdit
    //
    //  นี่คือจุดแรกในระบบที่ PageRole 'commenter' ต่างจาก 'viewer' จริง ๆ
    //  ก่อนหน้านี้ค่านั้นมีอยู่ใน enum และ CHECK constraint แต่ไม่มีโค้ดไหนแยก
    //  มันออกจาก viewer เลย — ทุกทางเขียนเช็ค canEdit()
    //
    //  ประโยชน์ที่ได้: ให้ AI (หรือผู้ตรวจ) รายงานได้แต่แก้เอกสารไม่ได้
    // ─────────────────────────────────────────────────────────────────────
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;
    if (!canComment(role)) {
      return err.forbidden('ต้องมีสิทธิ์แสดงความเห็นขึ้นไปจึงเขียนบันทึกได้', 'insufficient_page_role');
    }

    const page = await this.pages.get(pageId);
    if (!page) return PAGE_NOT_FOUND;

    const workspaceId = requireWorkspaceId();
    const userId = requireUserId();
    const id = uuidv7();

    // บันทึกกับประวัติต้องเกิดพร้อมกัน ไม่งั้นฟีดกิจกรรมไม่ตรงกับสิ่งที่อยู่ในหน้า
    await this.repo.addNote(
      { id, workspaceId, pageId, authorUserId: userId, body },
      buildActivity({
        workspaceId,
        pageId,
        pageTitle: page.title,
        actorUserId: userId,
        action: ActivityAction.NoteAdded,
        // เก็บตัวอย่างสั้น ๆ ไว้ในประวัติ เพื่อให้ฟีดอ่านรู้เรื่องโดยไม่ต้องดึงบันทึก
        detail: { preview: preview(body) },
      }),
    );

    this.logger.log(`เขียนบันทึกบนหน้า ${pageId} โดย ${userId}`);

    const rows = await this.repo.listNotes(pageId, NOTE_LIMIT);
    const saved = rows.find((r) => r.id === id);

    return ok(
      saved
        ? toNoteDto(saved)
        : {
            id,
            pageId,
            authorUserId: userId,
            authorName: null,
            authorKind: null,
            body,
            createdAt: new Date().toISOString(),
          },
    );
  }

  /** อ่านบันทึกต้องมีสิทธิ์เห็นหน้า — viewer อ่านได้ แต่เขียนไม่ได้ */
  async listNotes(pageId: string): Promise<Result<NoteDto[]>> {
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;

    const rows = await this.repo.listNotes(pageId, NOTE_LIMIT);
    return ok(rows.map(toNoteDto));
  }

  async getActivity(input: {
    pageId?: string;
    actorKind?: UserKind;
    since?: string;
    limit?: number;
  }): Promise<Result<ActivityFeedDto>> {
    // ─────────────────────────────────────────────────────────────────────
    //  กรองสิทธิ์
    //
    //  ถ้าระบุหน้าเดียว เช็คสิทธิ์หน้านั้นตรง ๆ ซึ่งถูกและถูกที่สุด
    //
    //  ถ้าเป็นฟีดทั้ง workspace: owner/admin เห็นทุกหน้าอยู่แล้ว จึงไม่ต้องส่ง id
    //  เป็นพันตัวเข้า query ส่วนคนอื่นต้องจำกัดด้วยรายการหน้าที่เห็นได้ — ยอมจ่าย
    //  เป็นการโหลด tree หนึ่งครั้ง ซึ่งเป็นสิ่งที่ sidebar ทำอยู่แล้ว
    // ─────────────────────────────────────────────────────────────────────
    if (input.pageId !== undefined) {
      // ⚠️ ถอยไปตรวจแบบที่เห็นหน้าที่อยู่ในถังขยะด้วย
      //
      //    ถ้าใช้แต่ตัวปกติ การถามประวัติของหน้าที่เพิ่งลบจะได้ 404 — ซึ่งเป็น
      //    จังหวะที่ประวัติมีค่าที่สุดพอดี ("ใครลบหน้านี้ และตอนนั้นมันชื่ออะไร")
      //    เป็นบั๊กคลาสเดียวกับที่ทางกู้คืนเคยเจอ (ดู PermissionService.resolveForDeleted)
      const role =
        (await this.permissions.effectiveRole(input.pageId)) ??
        (await this.permissions.resolveForDeleted(input.pageId));

      if (role === null) return PAGE_NOT_FOUND;
    }

    let visiblePageIds: string[] | null = null;

    if (input.pageId === undefined && !isWorkspaceWideEditor(requireRole())) {
      const tree = await this.pages.listTree();
      const visible = await this.permissions.visibleAccessRoots();
      visiblePageIds = tree.filter((n) => visible.has(n.accessRootId)).map((n) => n.id);
    }

    const effectiveLimit = Math.min(Math.max(input.limit ?? DEFAULT_ACTIVITY_LIMIT, 1), MAX_ACTIVITY_LIMIT);

    // ขอเกินมาหนึ่งแถวเพื่อรู้ว่ามีมากกว่านั้นจริงไหม โดยไม่ต้อง COUNT ซ้ำ
    const rows = await this.repo.listActivity({
      pageId: input.pageId ?? null,
      visiblePageIds,
      since: input.since ?? null,
      limit: effectiveLimit + 1,
    });

    // ⚠️ กรอง actorKind ในหน่วยความจำ ไม่ใช่ใน SQL โดยรู้ตัว — การ join users
    //    เข้าไปในเงื่อนไขทำให้ index (workspace_id, created_at) ใช้ไม่ได้เต็มที่
    //    และฟีดถูกจำกัดด้วย limit เล็ก ๆ อยู่แล้ว
    //
    //    ผลข้างเคียงที่ยอมรับ: เมื่อกรอง kind จำนวนที่ได้อาจน้อยกว่า limit ทั้งที่
    //    ยังมีแถวเก่ากว่านั้นอยู่ — จึงไม่รายงาน truncated เมื่อกรอง kind
    const filtered =
      input.actorKind === undefined ? rows : rows.filter((r) => r.actorKind === input.actorKind);

    const truncated = input.actorKind === undefined && filtered.length > effectiveLimit;
    const items = filtered.slice(0, effectiveLimit);

    return ok({ count: items.length, truncated, items: items.map(toActivityDto) });
  }
}

const toNoteDto = (row: NoteRow): NoteDto => ({
  id: row.id,
  pageId: row.pageId,
  authorUserId: row.authorUserId,
  authorName: row.authorName,
  authorKind: row.authorKind,
  body: row.body,
  createdAt: row.createdAt,
});

const toActivityDto = (row: ActivityFeedRow) => ({
  id: row.id,
  pageId: row.pageId,
  pageTitle: row.pageTitle,
  actorUserId: row.actorUserId,
  actorName: row.actorName,
  actorKind: row.actorKind,
  action: row.action,
  detail: row.detail,
  createdAt: row.createdAt,
});

/** ตัวอย่างข้อความสำหรับฟีด — สั้นพอที่จะอ่านผ่าน ๆ ได้ */
function preview(body: string): string {
  const max = 120;
  const single = body.replaceAll(/\r?\n/g, ' ');
  return single.length <= max ? single : `${single.slice(0, max)}…`;
}

const PAGE_NOT_FOUND = err.notFound('ไม่พบหน้านี้', 'page_not_found');
