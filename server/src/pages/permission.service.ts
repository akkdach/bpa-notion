import { Injectable } from '@nestjs/common';

import { PermissionRepository, type AclGrant } from './permission.repository.js';
import { currentContext, requireRole, requireUserId } from '../common/request-context.js';
import { isWorkspaceWideEditor, type PageRole } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  PermissionService — สิทธิ์ที่ผู้ใช้มีต่อ "หน้า" หนึ่ง ๆ
//
//  ⚠️ memo อยู่ใน RequestContext ไม่ใช่ field ของ service
//
//     service ใน Nest เป็น singleton — field บน instance จะถูกใช้ร่วมกันข้าม
//     request ซึ่งแปลว่าคำตอบเรื่องสิทธิ์ของผู้ใช้คนหนึ่งจะไปตอบให้อีกคน
//     (ฝั่ง C# ปลอดภัยจากข้อนี้เพราะ service เป็น scoped ต่อ request อยู่แล้ว
//      การพอร์ตมาตรง ๆ โดยไม่คิดเรื่องนี้คือบั๊กสิทธิ์ที่ร้ายแรงที่สุดแบบหนึ่ง)
//
//  ⚠️ ห้ามทำ cache ข้าม request ที่อายุยาวเมื่อรันหลาย instance — นั่นคือการ
//     cache "สิทธิ์ที่ล้าสมัย" แยกกันคนละเครื่อง
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ลำดับความสูงของสิทธิ์
 *
 * ⚠️ เรียงในหน่วยความจำ ไม่ใช่ ORDER BY ใน SQL — ค่าในฐานเป็น text การเรียง
 *    ตามตัวอักษรจะได้ commenter < editor < full < viewer ซึ่งไม่ใช่ลำดับ
 *    ความสูงของสิทธิ์เลย
 */
const RANK: Record<PageRole, number> = { viewer: 0, commenter: 1, editor: 2, full: 3 };

function cache(): Map<string, unknown> {
  const ctx = currentContext();
  if (!ctx) throw new Error('เรียก PermissionService นอก request context');
  return ctx.cache;
}

@Injectable()
export class PermissionService {
  constructor(private readonly repo: PermissionRepository) {}

  async effectiveRole(pageId: string): Promise<PageRole | null> {
    const key = `perm:${pageId}`;
    const memo = cache();

    if (memo.has(key)) return memo.get(key) as PageRole | null;

    const role = await this.resolve(pageId, false);
    memo.set(key, role);
    return role;
  }

  /**
   * สิทธิ์ที่มีต่อหน้าที่ "อยู่ในถังขยะแล้ว"
   *
   * ⚠️ ใช้ตัวปกติกับหน้าที่ถูกลบไม่ได้เลย — อาการที่เคยเกิดจริงฝั่ง .NET:
   *    สมาชิกธรรมดาลบหน้าของตัวเอง เห็นมันอยู่ในถังขยะ กดกู้คืนแล้วได้ 404
   *    "ไม่พบหน้านี้" ทั้งที่เพิ่งเห็นมันอยู่
   *
   * ⚠️ ไม่ memo โดยเจตนา — การใช้ key ร่วมกับตัวปกติจะทำให้คำตอบของสองคำถาม
   *    ที่ต่างกันปนกันภายใต้ key เดียว
   */
  resolveForDeleted(pageId: string): Promise<PageRole | null> {
    return this.resolve(pageId, true);
  }

  private async resolve(pageId: string, includeDeleted: boolean): Promise<PageRole | null> {
    const workspaceRole = requireRole();

    // ─── ทางลัดที่ใช้บ่อยที่สุด: owner/admin เห็นทุกหน้า ───────────────────
    if (isWorkspaceWideEditor(workspaceRole)) {
      // ยังต้องยืนยันว่าหน้านี้มีอยู่จริงใน workspace นี้ ไม่งั้นจะตอบว่า
      // "มีสิทธิ์" กับ id ที่เดามาแบบมั่ว ๆ
      return (await this.repo.pageExists(pageId, includeDeleted)) ? 'full' : null;
    }

    const grants = await this.repo.grantsForPage(pageId, requireUserId(), includeDeleted);
    return highest(grants, workspaceRole);
  }

  /** access root ทั้งหมดที่ผู้ใช้มองเห็น — เซ็ตเดียวกรองได้ทั้ง tree */
  async visibleAccessRoots(): Promise<Set<string>> {
    const key = 'perm:visibleRoots';
    const memo = cache();

    if (memo.has(key)) return memo.get(key) as Set<string>;

    const roots = new Set(
      await this.repo.visibleAccessRoots(requireUserId(), requireRole() !== 'guest'),
    );

    memo.set(key, roots);
    return roots;
  }
}

function highest(grants: AclGrant[], workspaceRole: string): PageRole | null {
  if (grants.length === 0) return null;

  // guest เห็นเฉพาะหน้าที่ถูกแชร์ให้ "ตัวเขาเอง" — grant ระดับ workspace ไม่นับ
  // ไม่งั้น guest จะเห็นทุกหน้าใน workspace ทันทีที่ถูกเชิญ
  const applicable =
    workspaceRole === 'guest' ? grants.filter((g) => g.subjectType !== 'workspace') : grants;

  if (applicable.length === 0) return null;

  return applicable.reduce((best, g) => (RANK[g.role] > RANK[best] ? g.role : best), applicable[0]!.role);
}
