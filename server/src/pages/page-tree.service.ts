import { Injectable, Logger } from '@nestjs/common';

import { between } from './fractional-index.js';
import { PageRepository, type PageNode, type PageRow, type TreeConsistency } from './page.repository.js';
import type {
  CreatePageInput,
  MovePageInput,
  MoveResultDto,
  PageDto,
  PageNodeDto,
  RepairResultDto,
  UpdatePageInput,
} from './pages.schema.js';
import { PermissionService } from './permission.service.js';
import { requireRole, requireUserId, requireWorkspaceId } from '../common/request-context.js';
import { err, ok, type Result } from '../common/result.js';
import { uuidv7 } from '../common/uuid.js';
import { ActivityAction, buildActivity, statusOrNone } from '../domain/activity.js';
import { canEdit, isWorkspaceWideEditor, type PageRole } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  PageTreeService
//
//  ดูแลค่าที่ denormalise ไว้สามตัวให้ตรงกันเสมอ:
//    · ancestor_ids   — root..parent (มี GIN index) ทำให้งาน subtree เป็น
//                       UPDATE เดียว และ breadcrumb เป็น query เดียว
//    · depth          — cardinality(ancestor_ids) มี CHECK constraint บังคับ
//    · access_root_id — ancestor-or-self ที่ใกล้สุดซึ่งมี ACL ของตัวเอง ทำให้
//                       ตรวจสิทธิ์เป็น query เดียวที่ความลึกคงที่
//
//  ⚠️ access_root_id เพี้ยน = บั๊กเรื่องสิทธิ์ ซึ่งเป็นบั๊กที่แย่ที่สุด จึงมี
//     checkConsistency/repair มาตั้งแต่ต้น และควรตั้งให้รันตรวจทุกวันในช่วง
//     เดือนแรก ๆ
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class PageTreeService {
  private readonly logger = new Logger(PageTreeService.name);

  constructor(
    private readonly pages: PageRepository,
    private readonly permissions: PermissionService,
  ) {}

  async getTree(): Promise<Result<PageNodeDto[]>> {
    const nodes = await this.pages.listTree();

    // owner/admin เห็นทุกหน้า — ข้ามการกรองไปเลย
    if (isWorkspaceWideEditor(requireRole())) return ok(nodes.map(toNodeDto));

    const visible = await this.permissions.visibleAccessRoots();
    return ok(nodes.filter((n) => visible.has(n.accessRootId)).map(toNodeDto));
  }

  async get(pageId: string): Promise<Result<PageDto>> {
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;

    const page = await this.pages.get(pageId);
    return page ? ok(toDto(page, role)) : PAGE_NOT_FOUND;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  สร้าง
  // ═══════════════════════════════════════════════════════════════════════
  async create(input: CreatePageInput): Promise<Result<PageDto>> {
    const workspaceId = requireWorkspaceId();
    const userId = requireUserId();

    let parent: PageRow | null = null;

    if (input.parentId) {
      // ต้องมีสิทธิ์ "แก้" ที่ parent ถึงจะสร้างลูกใต้มันได้
      const parentRole = await this.permissions.effectiveRole(input.parentId);
      if (!parentRole) return PAGE_NOT_FOUND;
      if (!canEdit(parentRole)) return NO_EDIT_PERMISSION;

      parent = await this.pages.get(input.parentId);
      if (!parent) return PAGE_NOT_FOUND;
    } else if (requireRole() === 'guest') {
      // guest สร้างหน้าระดับบนสุดไม่ได้ — จะกลายเป็นหน้าที่ไม่มีใครเห็น
      return err.forbidden('guest สร้างหน้าระดับบนสุดไม่ได้', 'insufficient_role');
    }

    const { before, after } = await this.pages.neighbourRanks(
      input.parentId ?? null,
      input.afterPageId ?? null,
    );

    const id = uuidv7();
    const title = input.title?.trim() ?? '';

    const page = {
      id,
      workspaceId,
      parentId: input.parentId ?? null,
      ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
      depth: parent ? parent.depth + 1 : 0,
      rank: between(before, after),
      title,
      icon: input.icon ?? null,
      status: input.status ?? null,
      // หน้าระดับบนสุดเป็น access root ของตัวเอง ส่วนหน้าลูกสืบทอดจากพ่อ
      accessRootId: parent?.accessRootId ?? id,
      createdBy: userId,
    };

    // ─────────────────────────────────────────────────────────────────────
    //  หน้าระดับบนสุดต้องมี ACL ของตัวเอง ไม่งั้นมันจะเป็น access root ที่ไม่มี
    //  grant ใด ๆ = ไม่มีใครเห็นเลย รวมทั้งคนสร้าง (owner/admin ยังเห็นเพราะ
    //  short-circuit แต่ member จะไม่เห็น)
    // ─────────────────────────────────────────────────────────────────────
    const acl = parent === null ? { role: 'editor', grantedBy: userId } : null;

    const created = await this.pages.create({
      page,
      acl,
      activity: buildActivity({
        workspaceId,
        pageId: id,
        pageTitle: title,
        actorUserId: userId,
        action: ActivityAction.PageCreated,
        detail: { parentId: page.parentId, status: statusOrNone(page.status) },
      }),
    });

    this.logger.log(`สร้างหน้า ${id} ใต้ ${page.parentId ?? 'ราก'} depth=${page.depth}`);

    return ok(toDto(created, 'full'));
  }

  async update(pageId: string, input: UpdatePageInput): Promise<Result<PageDto>> {
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;
    if (!canEdit(role)) return NO_EDIT_PERMISSION;

    const page = await this.pages.get(pageId);
    if (!page) return PAGE_NOT_FOUND;

    const workspaceId = requireWorkspaceId();
    const userId = requireUserId();

    // ⚠️ ของเดิมเตือนไว้ว่าต้อง validate สถานะก่อนเขียนอะไรเลย เพราะแต่ละส่วน
    //    เป็นธุรกรรมของตัวเอง — ที่นี่ทั้ง request เป็นธุรกรรมเดียว ปัญหา
    //    "แก้ไปครึ่ง ๆ กลาง ๆ" จึงหมดไป แต่ zod ก็ตรวจให้ตั้งแต่ก่อนเข้ามาอยู่ดี

    if (input.title !== undefined) {
      const title = input.title.trim();

      await this.pages.updateTitle(
        pageId,
        title,
        userId,
        buildActivity({
          workspaceId,
          pageId,
          pageTitle: title,
          actorUserId: userId,
          action: ActivityAction.PageRenamed,
          detail: { from: page.title, to: title },
        }),
      );

      page.title = title;
    }

    if (input.icon !== undefined || input.coverUrl !== undefined) {
      const icon = input.icon === undefined ? page.icon : input.icon;
      const coverUrl = input.coverUrl === undefined ? page.coverUrl : input.coverUrl;

      await this.pages.updateIcon(
        pageId,
        icon,
        coverUrl,
        userId,
        buildActivity({
          workspaceId,
          pageId,
          pageTitle: page.title,
          actorUserId: userId,
          action: ActivityAction.IconChanged,
          detail: { from: page.icon, to: icon },
        }),
      );

      page.icon = icon;
      page.coverUrl = coverUrl;
    }

    // สถานะงาน — null = ล้างสถานะ, ไม่ส่งมา = ไม่แตะ
    if (input.status !== undefined) {
      // เขียนประวัติเฉพาะเมื่อค่าเปลี่ยนจริง — การกด chip วนกลับมาที่เดิมหรือ
      // client ส่งค่าซ้ำ ไม่ควรทำให้ฟีดกิจกรรมเต็มไปด้วยแถวที่ไม่มีอะไรเกิด
      const changed = page.status !== input.status;

      await this.pages.updateStatus(
        pageId,
        input.status,
        userId,
        changed
          ? buildActivity({
              workspaceId,
              pageId,
              pageTitle: page.title,
              actorUserId: userId,
              action: ActivityAction.StatusChanged,
              detail: { from: statusOrNone(page.status), to: statusOrNone(input.status) },
            })
          : null,
      );

      page.status = input.status;
    }

    return ok(toDto(page, role));
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ย้าย
  // ═══════════════════════════════════════════════════════════════════════
  async move(pageId: string, input: MovePageInput): Promise<Result<MoveResultDto>> {
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;
    if (!canEdit(role)) return NO_EDIT_PERMISSION;

    const page = await this.pages.get(pageId);
    if (!page) return PAGE_NOT_FOUND;

    let newParent: PageRow | null = null;

    if (input.parentId) {
      if (input.parentId === pageId) {
        return err.validation('ย้ายหน้าไปไว้ใต้ตัวเองไม่ได้', 'cycle');
      }

      const parentRole = await this.permissions.effectiveRole(input.parentId);
      if (!parentRole) return PAGE_NOT_FOUND;
      if (!canEdit(parentRole)) return NO_EDIT_PERMISSION;

      newParent = await this.pages.get(input.parentId);
      if (!newParent) return PAGE_NOT_FOUND;

      // ─────────────────────────────────────────────────────────────────
      //  กันวงกลม: parent ใหม่ต้องไม่ใช่ลูกหลานของหน้าที่กำลังย้าย เช็คได้ด้วย
      //  การดูว่า pageId อยู่ใน ancestor_ids ของ parent ใหม่ไหม — ไม่ต้องไล่ tree
      //
      //  ถ้าปล่อยผ่าน จะได้ subtree ที่หลุดออกจาก tree ไปเลย (parent ชี้กันเป็นวง)
      //  แล้ว recursive CTE ตอนซ่อมจะวนไม่จบ
      // ─────────────────────────────────────────────────────────────────
      if (newParent.ancestorIds.includes(pageId)) {
        return err.validation('ย้ายหน้าไปไว้ใต้ลูกหลานของตัวเองไม่ได้', 'cycle');
      }
    } else if (requireRole() === 'guest') {
      return err.forbidden('guest ย้ายหน้าขึ้นระดับบนสุดไม่ได้', 'insufficient_role');
    }

    const { before, after } = await this.pages.neighbourRanks(
      input.parentId ?? null,
      input.afterPageId ?? null,
    );

    const newAncestors = newParent ? [...newParent.ancestorIds, newParent.id] : [];

    // ─────────────────────────────────────────────────────────────────────
    //  access root ใหม่
    //
    //  ถ้าหน้านี้มี ACL ของตัวเอง มันเป็น access root อยู่แล้ว การย้ายไม่เปลี่ยน
    //  อะไร ลูกหลานยังชี้มาที่มันเหมือนเดิม
    //
    //  ถ้าไม่มี มันสืบทอดจาก parent — ย้ายแล้วต้องเปลี่ยนตาม และลูกหลานที่เคย
    //  ชี้ที่ root เดิมต้องเปลี่ยนตามไปด้วย (ทำใน UPDATE เดียวกัน)
    // ─────────────────────────────────────────────────────────────────────
    const hasOwnAcl = await this.pages.hasOwnAcl(pageId);
    const newAccessRoot = hasOwnAcl ? pageId : (newParent?.accessRootId ?? pageId);

    // ย้ายขึ้นระดับบนสุดโดยไม่มี ACL ของตัวเอง = จะกลายเป็น access root ที่ไม่มี
    // grant ต้องสร้าง ACL ให้เหมือนตอนสร้างหน้าใหม่
    const workspaceId = requireWorkspaceId();
    const userId = requireUserId();

    const aclToAdd =
      newParent === null && !hasOwnAcl ? { workspaceId, role: 'editor', grantedBy: userId } : null;

    const affected = await this.pages.moveSubtree(
      {
        pageId,
        newParentId: input.parentId ?? null,
        newAncestorIds: newAncestors,
        oldDepth: page.depth,
        newRank: between(before, after),
        oldAccessRootId: page.accessRootId,
        newAccessRootId: newAccessRoot,
      },
      aclToAdd,
      buildActivity({
        workspaceId,
        pageId,
        pageTitle: page.title,
        actorUserId: userId,
        action: ActivityAction.PageMoved,
        detail: { fromParentId: page.parentId, toParentId: input.parentId ?? null },
      }),
    );

    this.logger.log(
      `ย้ายหน้า ${pageId} จาก depth ${page.depth} ไป ${newAncestors.length} — ลูกหลาน ${affected} หน้า`,
    );

    const moved = await this.pages.get(pageId);
    if (!moved) return PAGE_NOT_FOUND;

    return ok({ page: toDto(moved, role), affectedDescendants: affected });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ลบ / กู้คืน
  // ═══════════════════════════════════════════════════════════════════════
  async delete(pageId: string): Promise<Result<number>> {
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;
    if (!canEdit(role)) return NO_EDIT_PERMISSION;

    // อ่านชื่อไว้ก่อนลบ — เก็บลงประวัติเพื่อให้ตอบได้ว่า "ใครลบหน้าชื่ออะไร"
    // แม้หน้านั้นจะถูกลบถาวรไปแล้วในภายหลัง
    const page = await this.pages.get(pageId);
    if (!page) return PAGE_NOT_FOUND;

    const affected = await this.pages.softDeleteSubtree(
      pageId,
      buildActivity({
        workspaceId: requireWorkspaceId(),
        pageId,
        pageTitle: page.title,
        actorUserId: requireUserId(),
        action: ActivityAction.PageDeleted,
        detail: { status: statusOrNone(page.status) },
      }),
    );

    this.logger.log(`ลบหน้า ${pageId} พร้อมลูกหลาน รวม ${affected} หน้า`);
    return ok(affected);
  }

  async restore(pageId: string): Promise<Result<number>> {
    const page = await this.pages.getIncludingDeleted(pageId);
    if (!page) return PAGE_NOT_FOUND;

    if (!isWorkspaceWideEditor(requireRole())) {
      const role = await this.permissions.resolveForDeleted(page.accessRootId);
      if (!role || !canEdit(role)) return PAGE_NOT_FOUND;
    }

    // กู้คืนหน้าที่ parent ยังอยู่ในถังขยะ = ได้หน้ากำพร้าที่ไม่โผล่ใน sidebar
    // เพราะ parent มองไม่เห็น — ต้องกู้จากบนลงล่าง
    if (page.parentId) {
      const parent = await this.pages.getIncludingDeleted(page.parentId);
      if (parent?.deletedAt) {
        return err.conflict('หน้าแม่ยังอยู่ในถังขยะ — กู้คืนหน้าแม่ก่อน', 'parent_still_deleted');
      }
    }

    // ⚠️ ประวัติไม่เก็บชุด deleted_at เดิมของลูกหลาน จึง "ย้อน restore ไม่ได้"
    //    restoreSubtree กู้ทั้ง subtree แบบไม่มีเงื่อนไข รวมลูกที่ถูกลบไปก่อนหน้า
    //    นั้นแล้ว — การลบซ้ำจึงกู้ความต่างนั้นคืนไม่ได้
    const affected = await this.pages.restoreSubtree(
      pageId,
      buildActivity({
        workspaceId: requireWorkspaceId(),
        pageId,
        pageTitle: page.title,
        actorUserId: requireUserId(),
        action: ActivityAction.PageRestored,
      }),
    );

    return ok(affected);
  }

  async purge(pageId: string): Promise<Result<number>> {
    // ลบถาวรเป็นงานของ owner/admin เท่านั้น — ย้อนกลับไม่ได้
    if (!isWorkspaceWideEditor(requireRole())) {
      return err.forbidden('ต้องเป็น owner หรือ admin เท่านั้น', 'insufficient_role');
    }

    const page = await this.pages.getIncludingDeleted(pageId);
    if (!page) return PAGE_NOT_FOUND;

    if (page.deletedAt === null) {
      return err.conflict('ต้องย้ายไปถังขยะก่อนจึงจะลบถาวรได้', 'not_deleted');
    }

    const affected = await this.pages.purgeSubtree(pageId);
    this.logger.warn(`ลบถาวร ${pageId} พร้อมลูกหลาน รวม ${affected} หน้า`);

    return ok(affected);
  }

  async getTrash(): Promise<Result<PageNodeDto[]>> {
    const nodes = await this.pages.listTrash();

    // ⚠️ ถังขยะกรองตามสิทธิ์เหมือน tree ปกติ — ของเดิมไม่กรอง ซึ่งแปลว่า
    //    member เห็นชื่อหน้าที่ตัวเองไม่เคยมีสิทธิ์เห็นได้ผ่านถังขยะ
    if (isWorkspaceWideEditor(requireRole())) return ok(nodes.map(toNodeDto));

    const visible = await this.permissions.visibleAccessRoots();
    return ok(nodes.filter((n) => visible.has(n.accessRootId)).map(toNodeDto));
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Repair
  // ═══════════════════════════════════════════════════════════════════════

  async checkConsistency(): Promise<Result<TreeConsistency>> {
    if (!isWorkspaceWideEditor(requireRole())) {
      return err.forbidden('ต้องเป็น owner หรือ admin เท่านั้น', 'insufficient_role');
    }

    return ok(await this.pages.checkConsistency());
  }

  async repair(): Promise<Result<RepairResultDto>> {
    if (!isWorkspaceWideEditor(requireRole())) {
      return err.forbidden('ต้องเป็น owner หรือ admin เท่านั้น', 'insufficient_role');
    }

    // ลำดับสำคัญ: access_root_id คำนวณจาก ancestor_ids จึงต้องซ่อม ancestor_ids
    // ให้ถูกก่อน
    const fixedAncestors = await this.pages.rebuildAncestorIds();
    const fixedAccessRoots = await this.pages.recomputeAccessRoots();

    if (fixedAncestors > 0 || fixedAccessRoots > 0) {
      this.logger.warn(
        `ซ่อม tree ของ workspace ${requireWorkspaceId()}: ancestor_ids ${fixedAncestors} แถว, ` +
          `access_root_id ${fixedAccessRoots} แถว — ควรหาสาเหตุว่าเพี้ยนตอนไหน`,
      );
    }

    return ok({ fixedAncestors, fixedAccessRoots });
  }
}

const PAGE_NOT_FOUND = err.notFound('ไม่พบหน้านี้', 'page_not_found');
const NO_EDIT_PERMISSION = err.forbidden('ไม่มีสิทธิ์แก้ไขหน้านี้', 'insufficient_page_role');

/**
 * ⚠️ workspaceId ไม่ได้ออกไปกับ DTO เลย client ไม่จำเป็นต้องรู้ และการที่ต้อง
 *    พิมพ์ชื่อ field ทุกตัวเองคือสิ่งที่กันไม่ให้มันหลุดออกไป
 */
const toDto = (page: PageRow, myRole: PageRole): PageDto => ({
  id: page.id,
  parentId: page.parentId,
  ancestorIds: page.ancestorIds,
  depth: page.depth,
  rank: page.rank,
  kind: page.kind,
  title: page.title,
  icon: page.icon,
  coverUrl: page.coverUrl,
  status: page.status,
  accessRootId: page.accessRootId,
  myRole,
  lastEditedBy: page.lastEditedBy,
  createdAt: page.createdAt,
  updatedAt: page.updatedAt,
  deletedAt: page.deletedAt,
});

const toNodeDto = (node: PageNode): PageNodeDto => ({
  id: node.id,
  parentId: node.parentId,
  title: node.title,
  icon: node.icon,
  status: node.status,
  rank: node.rank,
  depth: node.depth,
  hasChildren: node.hasChildren,
  lastEditedBy: node.lastEditedBy,
  updatedAt: node.updatedAt,
  deletedAt: node.deletedAt,
});
