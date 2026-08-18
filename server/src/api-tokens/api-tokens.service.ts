import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { ApiTokenRepository, type ApiTokenRow } from './api-token.repository.js';
import type { ApiTokenDto, CreateApiTokenInput, CreatedApiTokenDto } from './api-tokens.schema.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { requireRole, requireUserId, requireWorkspaceId } from '../common/request-context.js';
import { err, ok, okVoid, type Result, type VoidResult } from '../common/result.js';
import { isWorkspaceWideEditor } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  ApiTokenService — ออกและเพิกถอนกุญแจของเครื่องภายนอก (MCP)
//
//  สิ่งที่ลูกค้าเห็นคือ "กดสร้าง token แล้วคัดลอกไปวาง" ส่วนบัญชี agent ที่ token
//  ทำงานแทนถูกสร้างให้อัตโนมัติเบื้องหลัง — เป็นรายละเอียดที่จำเป็นต่อการระบุ
//  ตัวผู้ทำ (activity_logs, last_edited_by) แต่ไม่ใช่สิ่งที่ลูกค้าต้องจัดการเอง
// ═══════════════════════════════════════════════════════════════════════════

/**
 * เพดานจำนวนใบที่ยังใช้ได้
 *
 * ไม่ใช่เรื่องพื้นที่เก็บ แต่เป็นเรื่องที่ว่า "รายการที่ยาวเกินไปคือรายการที่ไม่มี
 * ใครอ่าน" — ถ้ามีใบค้างอยู่ 200 ใบ คนจะไม่มีทางรู้ว่าใบไหนควรเพิกถอน ซึ่งทำให้
 * ปุ่มเพิกถอนไร้ความหมาย
 */
const MAX_ACTIVE_TOKENS = 20;

@Injectable()
export class ApiTokenService {
  private readonly logger = new Logger(ApiTokenService.name);

  constructor(
    private readonly repo: ApiTokenRepository,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
  ) {}

  async create(input: CreateApiTokenInput): Promise<Result<CreatedApiTokenDto>> {
    if (!isWorkspaceWideEditor(requireRole())) {
      return err.forbidden('ต้องเป็น owner หรือ admin เท่านั้น', 'insufficient_role');
    }

    const workspaceId = requireWorkspaceId();
    const existing = await this.repo.list(workspaceId);
    const active = existing.filter((t) => isActive(t)).length;

    if (active >= MAX_ACTIVE_TOKENS) {
      return err.conflict(
        `มี token ที่ใช้งานได้ ${active} ใบแล้ว — เพิกถอนใบที่ไม่ใช้ก่อน`,
        'too_many_tokens',
      );
    }

    const agent = await this.ensureAgent(workspaceId);
    if (!agent.ok) return agent;

    const pair = this.tokens.createApiToken();

    const token = await this.repo.create({
      workspaceId,
      userId: agent.value,
      name: input.name,
      tokenHash: pair.tokenHash,
      last4: pair.last4,
      createdBy: requireUserId(),
      expiresAt:
        input.expiresInDays === undefined || input.expiresInDays === null
          ? null
          : new Date(Date.now() + input.expiresInDays * 86_400_000),
    });

    this.logger.log(
      `ออก API token ${token.id} (${input.name}) ให้ workspace ${workspaceId} โดย ${requireUserId()}`,
    );

    // ค่าจริงออกจากระบบที่นี่ที่เดียว — หลังจากนี้เหลือแค่ hash ในฐาน
    return ok({
      id: token.id,
      name: token.name,
      token: pair.token,
      last4: token.last4,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
    });
  }

  async list(): Promise<Result<ApiTokenDto[]>> {
    if (!isWorkspaceWideEditor(requireRole())) {
      return err.forbidden('ต้องเป็น owner หรือ admin เท่านั้น', 'insufficient_role');
    }

    const rows = await this.repo.list(requireWorkspaceId());

    return ok(
      rows.map((t) => ({
        id: t.id,
        name: t.name,
        last4: t.last4,
        status: describeStatus(t),
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
        lastUsedAt: t.lastUsedAt,
      })),
    );
  }

  async revoke(tokenId: string): Promise<VoidResult> {
    if (!isWorkspaceWideEditor(requireRole())) {
      return err.forbidden('ต้องเป็น owner หรือ admin เท่านั้น', 'insufficient_role');
    }

    const revoked = await this.repo.revoke(requireWorkspaceId(), tokenId);

    if (!revoked) {
      return err.notFound('ไม่พบ token ใบนี้ หรือถูกเพิกถอนไปแล้ว', 'token_not_found');
    }

    this.logger.log(`เพิกถอน API token ${tokenId} โดย ${requireUserId()}`);
    return okVoid();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  บัญชี agent — สร้างให้เองถ้ายังไม่มี
  //
  //  ⚠️ รหัสผ่านของบัญชีนี้เป็นค่าสุ่มที่ "ไม่มีใครได้เห็น" และไม่มีที่ไหนเก็บไว้
  //     ตั้งใจ: บัญชีนี้ไม่ได้มีไว้ให้คน login ทางเว็บ มันมีไว้เพื่อเป็นเจ้าของ
  //     การกระทำที่ AI ทำ (activity_logs, last_edited_by) เท่านั้น
  //     ทางเข้าเดียวของมันคือ API token ซึ่งเพิกถอนได้รายใบ
  // ═══════════════════════════════════════════════════════════════════════
  private async ensureAgent(workspaceId: string): Promise<Result<string>> {
    const existing = await this.repo.findAgent(workspaceId);
    if (existing) return ok(existing.id);

    const slug = await this.repo.findWorkspaceSlug(workspaceId);
    if (slug === null) return err.notFound('ไม่พบ workspace', 'workspace_not_found');

    // อีเมลผูกกับ slug เพื่อให้แต่ละ workspace มีบัญชี AI ของตัวเองแยกกัน
    const email = `claude+${slug}@${slug}.local`;

    if (await this.repo.emailExists(email)) {
      // มีบัญชีอีเมลนี้อยู่แล้วแต่ไม่ได้เป็นสมาชิก/ไม่ได้เป็น agent ของ workspace นี้
      // — เกิดได้ถ้าเคยตั้งค่าแล้วถอดออกไป บอกให้ชัดดีกว่าสร้างซ้ำแล้วชนกัน
      return err.conflict(
        `มีบัญชี ${email} อยู่แล้วแต่ไม่ได้เป็นสมาชิกของ workspace นี้ — ` +
          'เชิญเข้ามาเป็น member แล้วตั้งประเภทเป็น agent ก่อน',
        'agent_account_conflict',
      );
    }

    const agentId = await this.repo.createAgent({
      workspaceId,
      email,
      // 256 บิตจาก CSPRNG แล้วทิ้ง — ไม่มีใครต้องรู้ค่านี้
      passwordHash: await this.passwords.hash(randomBytes(32).toString('base64')),
    });

    this.logger.log(`สร้างบัญชี agent ${agentId} ให้ workspace ${workspaceId}`);
    return ok(agentId);
  }
}

const isActive = (token: ApiTokenRow): boolean =>
  token.revokedAt === null &&
  (token.expiresAt === null || new Date(token.expiresAt).getTime() > Date.now());

const describeStatus = (token: ApiTokenRow): ApiTokenDto['status'] => {
  if (token.revokedAt !== null) return 'revoked';
  if (token.expiresAt !== null && new Date(token.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
};
