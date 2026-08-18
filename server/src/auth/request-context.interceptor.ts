import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { firstValueFrom, from, type Observable } from 'rxjs';

import { ApiTokenRepository } from '../api-tokens/api-token.repository.js';
import { ApiException } from '../common/api-response.js';
import { IS_PUBLIC, REQUIRES_WORKSPACE } from '../common/route-metadata.js';
import { type RequestContext, runWithContext } from '../common/request-context.js';
import { err } from '../common/result.js';
import { DbService } from '../db/db.service.js';
import type { WorkspaceRole } from '../domain/roles.js';
import { IdentityRepository } from './identity.repository.js';
import { API_TOKEN_PREFIX, TokenService } from './token.service.js';

export const WORKSPACE_HEADER = 'x-workspace-id';

// ═══════════════════════════════════════════════════════════════════════════
//  RequestContextInterceptor — ยืนยันตัวตน + หา workspace + เปิดธุรกรรม
//
//  รวมสามอย่างที่ฝั่ง C# แยกกันอยู่ (AuthConfiguration + ApiTokenAuthentication
//  Handler + TenantResolutionMiddleware) ไว้ที่เดียว
//
//  ── ทำไมเป็น interceptor ไม่ใช่ guard ──────────────────────────────────────
//  guard ตัดสินได้แค่ "ผ่าน/ไม่ผ่าน" มันครอบการทำงานของ handler ไม่ได้ แต่ RLS
//  ต้องการให้ทุก query อยู่ใน transaction ที่ตั้ง app.workspace_id ไว้แล้ว
//  interceptor ครอบได้ จึงเปิดธุรกรรมเดียวคลุมทั้ง request
//
//  ผลที่ได้ นอกจากความถูกต้องของ RLS:
//    · หนึ่ง request = หนึ่ง connection = หนึ่งธุรกรรม — handler ที่เขียนหลาย
//      ตารางแล้วพังกลางทางจะ rollback ทั้งหมดโดยไม่ต้องเขียนอะไรเพิ่ม
//    · ตรวจสมาชิกภาพอยู่ในธุรกรรมเดียวกับงานจริง ไม่ใช่ query แยกก่อนหน้า
//
//  ⚠️ ราคาที่ต้องรู้: connection ถูกถือไว้ตลอดอายุของ handler ถ้าวันหนึ่งมี
//     endpoint ที่รอ I/O ภายนอกนาน ๆ (เรียก API อื่น, ประมวลผลไฟล์ใหญ่) ต้อง
//     ย้ายมันออกไปนอกธุรกรรม ไม่ใช่ปล่อยให้กิน connection ใน pool
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestContextInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
    private readonly tokens: TokenService,
    private readonly identity: IdentityRepository,
    private readonly apiTokens: ApiTokenRepository,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.run(ctx, next));
  }

  private async run(ctx: ExecutionContext, next: CallHandler): Promise<unknown> {
    const request = ctx.switchToHttp().getRequest<Request>();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const needsWorkspace = this.reflector.getAllAndOverride<boolean>(REQUIRES_WORKSPACE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const bearer = readBearer(request);

    // ─── endpoint สาธารณะ: login / register / refresh / health ────────────
    if (isPublic && !bearer) {
      return this.db.withoutTenant(() => runWithContext(emptyContext(), () => handle(next)));
    }

    if (!bearer) {
      throw new ApiException(err.unauthorized('ต้องเข้าสู่ระบบก่อน', 'unauthenticated').error);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  แยก API token ออกจาก JWT ด้วย prefix ไม่ใช่ด้วยการ "ลอง verify JWT
    //  ก่อนแล้วค่อย fallback" — แบบหลังทำให้ทุก API token เสียเวลาไปกับการ
    //  validate ที่ล้มเหลวแน่นอน และ log เต็มไปด้วย token ผิดรูปที่ไม่ใช่ปัญหา
    // ─────────────────────────────────────────────────────────────────────
    const auth = bearer.startsWith(API_TOKEN_PREFIX)
      ? await this.authenticateApiToken(bearer, request)
      : await this.authenticateJwt(bearer);

    return this.db.withScope({ userId: auth.userId }, async (session) => {
      const scope = await this.resolveWorkspace(auth, request, needsWorkspace === true);

      if (scope) await session.enterWorkspace(scope.workspaceId);

      const context: RequestContext = {
        userId: auth.userId,
        workspaceId: scope?.workspaceId ?? null,
        role: scope?.role ?? null,
        apiTokenId: auth.apiTokenId,
        cache: new Map(),
      };

      return runWithContext(context, () => handle(next));
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ยืนยันตัวตน
  // ═══════════════════════════════════════════════════════════════════════

  private async authenticateJwt(token: string): Promise<Authenticated> {
    const claims = await this.tokens.verifyAccessToken(token);

    if (!claims?.sub) {
      throw new ApiException(err.unauthorized('token ไม่ถูกต้องหรือหมดอายุ', 'invalid_token').error);
    }

    return { userId: claims.sub, tokenWorkspaceId: null, apiTokenId: null };
  }

  /**
   * ⚠️ ตรวจกับฐานข้อมูลทุก request โดยเจตนา ไม่ cache
   *
   *    "เพิกถอนแล้วต้องมีผลทันที" เป็นคุณสมบัติหลักของ token — cache 5 วินาที
   *    ก็แปลว่ามีหน้าต่าง 5 วินาทีที่ใบที่ถูกเพิกถอนยังใช้ได้
   *    ราคาที่จ่ายคือ index lookup หนึ่งครั้งต่อคำขอ ซึ่งถูกกว่าที่คิดมาก
   *
   * ⚠️ resolve ต้องอยู่นอก tenant scope — workspace มาจากตัว token เอง
   *    (api_tokens จึงไม่มี RLS policy ดูเหตุผลใน sql/objects.sql)
   */
  private async authenticateApiToken(token: string, request: Request): Promise<Authenticated> {
    const hash = this.tokens.hashToken(token);
    const principal = await this.db.withoutTenant(() => this.apiTokens.resolve(hash));

    if (!principal) {
      // ข้อความเดียวสำหรับทุกสาเหตุ (ไม่มีใบนี้ / เพิกถอนแล้ว / หมดอายุ / ถูกถอด
      // ออกจาก workspace) — การบอกว่า "ใบนี้มีอยู่จริงแต่ถูกเพิกถอน" คือการ
      // ยืนยันให้คนที่ได้ token ไปว่าเขาได้ของจริงมา
      this.logger.warn(`ปฏิเสธ API token ที่ใช้ไม่ได้ (path ${request.originalUrl})`);
      throw new ApiException(err.unauthorized('API token ใช้ไม่ได้', 'invalid_api_token').error);
    }

    await this.db.withoutTenant(() => this.apiTokens.touch(principal.tokenId));

    return {
      userId: principal.userId,
      tokenWorkspaceId: principal.workspaceId,
      apiTokenId: principal.tokenId,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  หา workspace
  // ═══════════════════════════════════════════════════════════════════════

  private async resolveWorkspace(
    auth: Authenticated,
    request: Request,
    needsWorkspace: boolean,
  ): Promise<{ workspaceId: string; role: WorkspaceRole } | null> {
    const header = readWorkspaceHeader(request);

    // ─────────────────────────────────────────────────────────────────────
    //  API token พกworkspace มาในตัว
    //
    //  ⚠️ ค่านี้ "ชนะ" header เสมอ และถ้า header ชี้ไปคนละที่ต้องปฏิเสธ
    //     ไม่ใช่เงียบ ๆ ใช้ค่าจาก token
    //
    //     บัญชี agent เป็นสมาชิกได้หลาย workspace ถ้าไม่ตรวจข้อนี้ ใบที่ออกให้
    //     workspace A จะใช้กับ B ได้ทันทีแค่เปลี่ยน header — ซึ่งทำให้ "token
    //     ผูกกับ workspace" ที่โฆษณาไว้ไม่เป็นจริงเลย
    // ─────────────────────────────────────────────────────────────────────
    if (auth.tokenWorkspaceId) {
      if (header !== null && header !== auth.tokenWorkspaceId) {
        this.logger.warn(
          `API token ของ workspace ${auth.tokenWorkspaceId} ถูกใช้เรียก workspace ${header}`,
        );
        throw new ApiException(
          err.forbidden('token นี้ใช้ได้กับ workspace ที่ออกให้เท่านั้น', 'token_workspace_mismatch')
            .error,
        );
      }

      return this.requireMembership(auth.userId, auth.tokenWorkspaceId);
    }

    if (header === null) {
      if (needsWorkspace) {
        throw new ApiException(
          err.validation(
            `ต้องระบุ workspace ผ่าน header X-Workspace-Id`,
            'workspace_required',
          ).error,
        );
      }
      // request ที่ไม่ผูก workspace (/me, list workspaces) — ปกติ
      return null;
    }

    if (!UUID.test(header)) {
      throw new ApiException(
        err.validation('X-Workspace-Id ต้องเป็น UUID', 'invalid_workspace_header').error,
      );
    }

    return this.requireMembership(auth.userId, header);
  }

  private async requireMembership(
    userId: string,
    workspaceId: string,
  ): Promise<{ workspaceId: string; role: WorkspaceRole }> {
    const role = await this.identity.resolveMembership(userId, workspaceId);

    if (!role) {
      // ─────────────────────────────────────────────────────────────────
      //  404 ไม่ใช่ 403 โดยเจตนา
      //
      //  403 แปลว่า "workspace นี้มีอยู่จริงแต่คุณไม่มีสิทธิ์" ซึ่งทำให้คนนอก
      //  เดาได้ว่า workspace id ไหนมีอยู่จริง — เป็นการรั่วข้อมูลข้าม tenant
      //  แม้จะเล็กน้อย
      // ─────────────────────────────────────────────────────────────────
      this.logger.warn(`user ${userId} พยายามเข้า workspace ${workspaceId} ที่ไม่ได้เป็นสมาชิก`);
      throw new ApiException(err.notFound('ไม่พบ workspace', 'workspace_not_found').error);
    }

    return { workspaceId, role };
  }
}

interface Authenticated {
  userId: string;
  /** workspace ที่ API token ผูกไว้ — null เมื่อมาด้วย JWT ของเบราว์เซอร์ */
  tokenWorkspaceId: string | null;
  apiTokenId: string | null;
}

/** ⚠️ ต้องสร้างใหม่ทุกครั้ง ไม่ใช่ค่าคงที่ร่วม — cache เป็น Map ที่เขียนได้ */
const emptyContext = (): RequestContext => ({
  userId: null,
  workspaceId: null,
  role: null,
  apiTokenId: null,
  cache: new Map(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * รอให้ handler ทำงานจนจบ "ก่อน" ธุรกรรมจะ commit
 *
 * ⚠️ next.handle() คืน Observable ที่ยังไม่ทำงานจนกว่าจะมีคน subscribe
 *    ถ้าคืนมันออกไปเฉย ๆ ธุรกรรมจะ commit ก่อนที่ handler จะเริ่มด้วยซ้ำ
 *    แล้ว query ทุกเส้นจะวิ่งนอกขอบเขต tenant — ซึ่งกับ RLS แปลว่า "เห็นว่าง"
 */
const handle = (next: CallHandler): Promise<unknown> => firstValueFrom(next.handle());

const readBearer = (request: Request): string | null => {
  const header = request.headers.authorization;
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  const value = header.slice('bearer '.length).trim();
  return value.length > 0 ? value : null;
};

const readWorkspaceHeader = (request: Request): string | null => {
  const raw = request.headers[WORKSPACE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
};
