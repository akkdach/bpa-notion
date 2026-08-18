import { Injectable, Logger } from '@nestjs/common';

import { normalizeSlug, slugFromName, slugWithSuffix } from './slug.js';
import { isUniqueViolation, WorkspaceRepository, type MemberRow } from './workspace.repository.js';
import type {
  AddMemberInput,
  CreateWorkspaceInput,
  MemberDto,
  UpdateMemberInput,
  UpdateWorkspaceInput,
  WorkspaceDetailDto,
  WorkspaceSummaryDto,
} from './workspaces.schema.js';
import { IdentityRepository } from '../auth/identity.repository.js';
import { requireRole, requireUserId, requireWorkspaceId } from '../common/request-context.js';
import { err, ok, okVoid, type Result, type VoidResult } from '../common/result.js';
import { currentSession } from '../db/db.service.js';
import { isWorkspaceWideEditor, USER_KINDS, type UserKind } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  WorkspaceService
//
//  การเพิ่มสมาชิกใช้ "อีเมลของ user ที่สมัครไว้แล้ว" ไม่มีการเชิญทางอีเมล
//  (ตามที่ตกลงไว้ — ไม่มี SMTP dependency ในระบบนี้)
// ═══════════════════════════════════════════════════════════════════════════

/** กันการวนหา slug ไม่รู้จบเมื่อชนกันซ้ำ ๆ */
const MAX_SLUG_ATTEMPTS = 5;

const UX_SLUG = 'ux_workspaces_slug';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly identity: IdentityRepository,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  //  สร้าง
  //
  //  ── ต่างจากฝั่ง C# ตรงนี้ และดีกว่าเดิม ──────────────────────────────────
  //  ของเดิมเช็ค "slug นี้มีคนใช้แล้วหรือยัง" ก่อนแล้วค่อย INSERT ซึ่งมีสองปัญหา:
  //
  //    1. TOCTOU — สอง request ที่ขอ slug เดียวกันพร้อมกันผ่านการเช็คทั้งคู่
  //       แล้วตัวที่สองไปตายที่ unique index กลายเป็น 500
  //    2. การเช็คต้องอ่าน workspace ของคนอื่น ซึ่งภายใต้ RLS ทำไม่ได้ (และไม่ควร
  //       ทำได้) — ทางเดียวคือเปิดช่องพิเศษให้อ่านข้าม tenant
  //
  //  ที่นี่ปล่อยให้ unique index เป็นคนตัดสิน แล้วดักข้อผิดพลาดของมัน วิธีนี้
  //  ไม่มี race และไม่ต้องเจาะ RLS เลย
  // ═══════════════════════════════════════════════════════════════════════
  async create(input: CreateWorkspaceInput): Promise<Result<WorkspaceSummaryDto>> {
    const creatorId = requireUserId();
    const name = input.name.trim();

    // slug ที่ผู้ใช้ระบุเอง — ชนแล้วต้องแจ้ง ไม่ใช่เงียบ ๆ เปลี่ยนให้
    if (input.slug !== undefined && input.slug !== null && input.slug.trim() !== '') {
      const normalized = normalizeSlug(input.slug);

      if (normalized === null) {
        return err.validation(
          'slug ต้องมีตัวอักษรภาษาอังกฤษหรือตัวเลขอย่างน้อย 3 ตัว',
          'invalid_slug',
        );
      }

      try {
        return ok(await this.attempt(normalized, name, input.icon ?? null, creatorId));
      } catch (error) {
        if (isUniqueViolation(error, UX_SLUG)) {
          return err.conflict(`slug '${normalized}' ถูกใช้แล้ว`, 'slug_taken');
        }
        throw error;
      }
    }

    // slug ที่ระบบสร้างเอง — ชนแล้วเติมท้ายให้เงียบ ๆ ได้ เพราะผู้ใช้ไม่ได้เลือก
    let candidate = slugFromName(name);

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        return ok(await this.attempt(candidate, name, input.icon ?? null, creatorId));
      } catch (error) {
        if (!isUniqueViolation(error, UX_SLUG)) throw error;
        candidate = slugWithSuffix(slugFromName(name));
      }
    }

    // ถึงตรงนี้แปลว่าสุ่มชนกัน 5 ครั้งติด ซึ่งแทบเป็นไปไม่ได้
    this.logger.error(`หา slug ที่ว่างไม่ได้หลังลอง ${MAX_SLUG_ATTEMPTS} ครั้ง`);
    return err.conflict('สร้าง slug ไม่สำเร็จ กรุณาระบุ slug เอง', 'slug_generation_failed');
  }

  /**
   * ⚠️ ต้องอยู่ใน savepoint — ทั้ง request เป็นธุรกรรมเดียว การที่ INSERT ชน
   *    unique index จะทำให้ธุรกรรมเข้าสถานะ aborted แล้วการลองชื่อใหม่จะตอบ
   *    "current transaction is aborted" แทนที่จะเป็นการชนซ้ำ
   */
  private attempt(
    slug: string,
    name: string,
    icon: string | null,
    creatorId: string,
  ): Promise<WorkspaceSummaryDto> {
    const session = currentSession();
    if (!session) throw new Error('create ถูกเรียกนอกธุรกรรม');

    return session.savepoint(() => this.insert(slug, name, icon, creatorId));
  }

  private async insert(
    slug: string,
    name: string,
    icon: string | null,
    creatorId: string,
  ): Promise<WorkspaceSummaryDto> {
    const workspace = await this.workspaces.createWithOwner({ slug, name, icon, creatorId });

    this.logger.log(`สร้าง workspace ${workspace.id} (${workspace.slug}) โดย ${creatorId}`);

    return {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      icon: workspace.icon,
      role: 'owner',
    };
  }

  async listMine(): Promise<Result<WorkspaceSummaryDto[]>> {
    const rows = await this.identity.listMemberships(requireUserId());

    return ok(
      rows.map((r) => ({
        id: r.workspaceId,
        slug: r.slug,
        name: r.name,
        icon: r.icon,
        role: r.role,
      })),
    );
  }

  async getCurrent(): Promise<Result<WorkspaceDetailDto>> {
    const workspaceId = requireWorkspaceId();
    const workspace = await this.workspaces.getCurrent(workspaceId);

    // interceptor ตรวจสมาชิกภาพมาแล้ว ถ้ามาถึงตรงนี้แล้วไม่เจอแปลว่า workspace
    // ถูกลบระหว่างทาง
    if (!workspace) return WORKSPACE_NOT_FOUND;

    return ok({
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      icon: workspace.icon,
      myRole: requireRole(),
      memberCount: await this.workspaces.countMembers(workspaceId),
      createdAt: workspace.createdAt,
    });
  }

  async update(input: UpdateWorkspaceInput): Promise<Result<WorkspaceDetailDto>> {
    if (!isWorkspaceWideEditor(requireRole())) return INSUFFICIENT_ROLE;

    const workspaceId = requireWorkspaceId();
    const workspace = await this.workspaces.getCurrent(workspaceId);
    if (!workspace) return WORKSPACE_NOT_FOUND;

    await this.workspaces.update(workspaceId, {
      name: input.name.trim(),
      icon: input.icon === undefined ? workspace.icon : input.icon,
    });

    return this.getCurrent();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  สมาชิก
  // ═══════════════════════════════════════════════════════════════════════

  async listMembers(): Promise<Result<MemberDto[]>> {
    const rows = await this.workspaces.listMembers(requireWorkspaceId());
    return ok(rows.map(toMemberDto));
  }

  async addMember(input: AddMemberInput): Promise<Result<MemberDto>> {
    const actorRole = requireRole();
    if (!isWorkspaceWideEditor(actorRole)) return INSUFFICIENT_ROLE;

    // owner แต่งตั้ง owner ได้เท่านั้น — admin ยกระดับตัวเองไม่ได้ผ่านทางอ้อม
    if (input.role === 'owner' && actorRole !== 'owner') return OWNER_ONLY;

    const user = await this.identity.findUserByEmail(input.email.trim());

    if (!user) {
      // ระบบนี้ไม่มีการเชิญทางอีเมล ผู้ใช้ต้องสมัครเองก่อน
      return err.notFound(
        'ไม่พบผู้ใช้ที่ใช้อีเมลนี้ — ให้ผู้ใช้สมัครสมาชิกก่อนแล้วค่อยเพิ่มเข้า workspace',
        'user_not_registered',
      );
    }

    const workspaceId = requireWorkspaceId();

    if (await this.workspaces.findMember(workspaceId, user.id)) {
      return err.conflict('ผู้ใช้นี้เป็นสมาชิกอยู่แล้ว', 'already_member');
    }

    const joinedAt = await this.workspaces.addMember({
      workspaceId,
      userId: user.id,
      role: input.role,
    });

    this.logger.log(`เพิ่ม ${user.id} เข้า workspace ${workspaceId} เป็น ${input.role}`);

    return ok({
      userId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: input.role,
      kind: user.kind,
      joinedAt,
    });
  }

  async updateMember(userId: string, input: UpdateMemberInput): Promise<VoidResult> {
    const actorRole = requireRole();
    if (!isWorkspaceWideEditor(actorRole)) return INSUFFICIENT_ROLE;

    const workspaceId = requireWorkspaceId();
    const member = await this.workspaces.findMember(workspaceId, userId);
    if (!member) return MEMBER_NOT_FOUND;

    if (input.role === 'owner' && actorRole !== 'owner') return OWNER_ONLY;

    // ─────────────────────────────────────────────────────────────────────
    //  กัน workspace กำพร้า: ถ้าลดสิทธิ์ owner คนสุดท้าย จะไม่เหลือใครที่ลบ
    //  workspace หรือแต่งตั้ง owner คนใหม่ได้อีกเลย
    // ─────────────────────────────────────────────────────────────────────
    if (member.role === 'owner' && input.role !== 'owner') {
      if ((await this.workspaces.countOwners(workspaceId)) <= 1) return LAST_OWNER;
    }

    await this.workspaces.updateMemberRole(workspaceId, userId, input.role);

    // ประเภทบัญชี (คน / AI) — ไม่บังคับ ส่งมาเมื่อต้องการเปลี่ยนเท่านั้น
    if (input.kind !== undefined && input.kind !== null) {
      const kind = input.kind.trim().toLowerCase();

      if (!(USER_KINDS as readonly string[]).includes(kind)) {
        return err.validation(
          `ไม่รู้จักประเภทบัญชี '${input.kind}' — ต้องเป็น ${USER_KINDS.join(' หรือ ')}`,
          'invalid_user_kind',
        );
      }

      await this.workspaces.updateUserKind(userId, kind as UserKind);
      this.logger.log(`ตั้งประเภทบัญชี ${userId} เป็น ${kind} โดย ${requireUserId()}`);
    }

    return okVoid();
  }

  async removeMember(userId: string): Promise<VoidResult> {
    const isSelf = userId === requireUserId();

    // ออกจาก workspace เองได้เสมอ แต่การถอดคนอื่นต้องมีสิทธิ์
    if (!isSelf && !isWorkspaceWideEditor(requireRole())) return INSUFFICIENT_ROLE;

    const workspaceId = requireWorkspaceId();
    const member = await this.workspaces.findMember(workspaceId, userId);
    if (!member) return MEMBER_NOT_FOUND;

    if (member.role === 'owner' && (await this.workspaces.countOwners(workspaceId)) <= 1) {
      return LAST_OWNER;
    }

    await this.workspaces.removeMember(workspaceId, userId);
    this.logger.log(`ถอด ${userId} ออกจาก workspace ${workspaceId}`);

    return okVoid();
  }
}

const toMemberDto = (row: MemberRow): MemberDto => ({
  userId: row.userId,
  email: row.email,
  name: row.name,
  avatarUrl: row.avatarUrl,
  role: row.role,
  kind: row.kind,
  joinedAt: row.joinedAt,
});

const WORKSPACE_NOT_FOUND = err.notFound('ไม่พบ workspace', 'workspace_not_found');
const MEMBER_NOT_FOUND = err.notFound('ไม่พบสมาชิกคนนี้', 'member_not_found');
const INSUFFICIENT_ROLE = err.forbidden('ต้องเป็น owner หรือ admin เท่านั้น', 'insufficient_role');
const OWNER_ONLY = err.forbidden('เฉพาะ owner เท่านั้นที่แต่งตั้ง owner ได้', 'insufficient_role');
const LAST_OWNER = err.conflict(
  'ต้องมี owner อย่างน้อยหนึ่งคน — แต่งตั้ง owner คนใหม่ก่อน',
  'last_owner',
);
