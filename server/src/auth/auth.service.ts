import { Injectable, Logger } from '@nestjs/common';

import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
  UserDto,
  WorkspaceSummaryDto,
} from './auth.schema.js';
import { IdentityRepository, type MembershipRow, type UserRow } from './identity.repository.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { err, ok, okVoid, type Result, type VoidResult } from '../common/result.js';
import { currentSession, DbService } from '../db/db.service.js';

/** ข้อมูลของเครื่องที่ยิงมา — เก็บไว้กับ refresh token เพื่อให้รู้ว่าใบไหนของเครื่องไหน */
export interface ClientInfo {
  userAgent: string | null;
  ipAddress: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  AuthService — register / login / refresh / logout
//  ไม่มีอีเมลยืนยัน ไม่มี SSO (email + password + JWT เท่านั้น)
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // ธุรกรรมถูกเปิดไว้แล้วรอบทั้ง request โดย RequestContextInterceptor ทุก
  // query ในนี้จึงอยู่ในขอบเขตเดียวกันและ commit/rollback พร้อมกันโดยอัตโนมัติ
  // — DbService ที่ inject มาใช้เฉพาะสองอย่างที่ต้องออกนอกกรอบนั้น:
  // เปลี่ยนขอบเขตกลางธุรกรรม (login) และเขียนสิ่งที่ต้องอยู่รอด (เพิกถอน)
  constructor(
    private readonly db: DbService,
    private readonly identity: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterInput, client: ClientInfo): Promise<Result<AuthResponse>> {
    const email = input.email.trim();

    if (await this.identity.emailExists(email)) {
      // ─────────────────────────────────────────────────────────────────
      //  ตรงนี้บอกตรง ๆ ว่าอีเมลถูกใช้แล้ว = เปิดเผยว่ามีบัญชีนี้อยู่
      //
      //  ยอมรับ trade-off นี้เพราะทางเลือกอื่น (ตอบสำเร็จปลอม ๆ แล้วส่งอีเมล
      //  แจ้ง) ต้องมี SMTP ซึ่งไม่มีในระบบนี้ และการไม่บอกทำให้ผู้ใช้ที่ลืมว่า
      //  สมัครแล้วติดอยู่โดยไม่รู้สาเหตุ
      //
      //  ผลกระทบจำกัด: นี่คือ workspace ภายในองค์กร ไม่ใช่บริการสาธารณะที่การ
      //  มีบัญชีอยู่เป็นความลับ
      // ─────────────────────────────────────────────────────────────────
      return err.conflict('อีเมลนี้ถูกใช้แล้ว', 'email_taken');
    }

    const user = await this.identity.createUser({
      email,
      passwordHash: await this.passwords.hash(input.password),
      name: input.name.trim(),
    });

    this.logger.log(`สมัครสมาชิกใหม่ ${user.id}`);

    await enterIdentity(user.id);
    return ok(await this.issueTokens(user, client, []));
  }

  async login(input: LoginInput, client: ClientInfo): Promise<Result<AuthResponse>> {
    const user = await this.identity.findUserByEmail(input.email.trim());

    if (!user) {
      // ยังคงเผาเวลาเท่ากับการ verify จริง ไม่งั้นอีเมลที่ไม่มีในระบบจะตอบเร็ว
      // กว่าอย่างชัดเจน จนไล่หารายชื่ออีเมลที่มีอยู่ได้จากเวลาตอบสนองล้วน ๆ
      await this.passwords.burnTime(input.password);
      return INVALID_CREDENTIALS;
    }

    if (!(await this.passwords.verify(input.password, user.passwordHash))) {
      // ข้อความเดียวกันทั้งสองกรณี — ไม่บอกว่าอีเมลผิดหรือรหัสผิด
      return INVALID_CREDENTIALS;
    }

    // ⚠️ ก่อนบรรทัดนี้ธุรกรรมยังไม่รู้ว่าเราเป็นใคร (login เป็น @Public) รายการ
    //    workspace ที่อ่านต่อจากนี้จึงจะว่างเปล่าถ้าไม่ตั้งก่อน — ไม่ error
    //    ไม่เตือน แค่ว่าง ซึ่งเป็นอาการที่ RLS ให้เสมอเมื่อไม่มีขอบเขต
    await enterIdentity(user.id);

    await this.identity.touchLastLogin(user.id);
    const memberships = await this.identity.listMemberships(user.id);

    return ok(await this.issueTokens(user, client, memberships.map(toSummary)));
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<Result<AuthResponse>> {
    const stored = await this.identity.findRefreshTokenWithUser(this.tokens.hashToken(refreshToken));

    if (!stored?.user) {
      return err.unauthorized('refresh token ไม่ถูกต้อง', 'invalid_refresh_token');
    }

    // ─────────────────────────────────────────────────────────────────────
    //  ตรวจการใช้ token ที่ rotate แล้วซ้ำ
    //
    //  ถ้ามีคนเอา token ที่ถูกยกเลิกแล้วมาใช้ แปลว่ามีสำเนาอยู่ในมือคนอื่น
    //  (คนที่ขโมยไป หรือคนที่เป็นเจ้าของ — เราแยกไม่ออก) ทางที่ปลอดภัยคือ
    //  ยกเลิกทุกใบของ user นั้นแล้วให้ login ใหม่
    //
    //  ถ้าไม่ทำ ผู้ที่ขโมย token ไปจะ refresh ต่อได้เรื่อย ๆ ไม่มีสิ้นสุด
    // ─────────────────────────────────────────────────────────────────────
    if (stored.revokedAt !== null) {
      // ─────────────────────────────────────────────────────────────────
      //  ⚠️ ต้องเป็นธุรกรรมของตัวเอง ไม่ใช่ธุรกรรมของ request
      //
      //  เราจะตอบ 401 ต่อจากนี้ ซึ่งเกิดจากการ throw ที่ชั้น controller
      //  แล้วธุรกรรมของ request ทั้งก้อนจะถูก rollback — รวมถึงการเพิกถอนนี้
      //  ผลคือระบบตรวจเจอว่า token รั่ว ประกาศว่าล้าง session แล้ว แต่ไม่ได้
      //  ล้างอะไรเลย และไม่มีอาการอะไรให้เห็น
      // ─────────────────────────────────────────────────────────────────
      const count = await this.db.withOwnTransaction({}, () =>
        this.identity.revokeAllForUser(stored.userId),
      );

      this.logger.warn(
        `ยกเลิก refresh token ${count} ใบของ user ${stored.userId} — ` +
          'ตรวจพบการใช้ token ที่ถูก rotate แล้วซ้ำ สงสัยว่า token รั่ว',
      );

      return err.unauthorized(
        'session ถูกยกเลิกด้วยเหตุผลด้านความปลอดภัย กรุณาเข้าสู่ระบบใหม่',
        'refresh_token_reused',
      );
    }

    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
      return err.unauthorized('refresh token หมดอายุ', 'refresh_token_expired');
    }

    const replacement = this.tokens.createRefreshToken();
    await this.identity.rotateRefreshToken(stored.id, {
      userId: stored.userId,
      tokenHash: replacement.tokenHash,
      expiresAt: replacement.expiresAt,
      userAgent: truncate(client.userAgent, 400),
      ipAddress: truncate(client.ipAddress, 45),
    });

    const memberships = await this.identity.listMemberships(stored.userId);
    const access = await this.tokens.createAccessToken(stored.user);
    const full = await this.identity.findUserById(stored.userId);

    if (!full) return err.unauthorized('ไม่พบผู้ใช้', 'user_not_found');

    return ok({
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: replacement.token,
      refreshTokenExpiresAt: replacement.expiresAt.toISOString(),
      user: toUserDto(full),
      workspaces: memberships.map(toSummary),
    });
  }

  async logout(refreshToken: string): Promise<VoidResult> {
    const stored = await this.identity.findRefreshTokenWithUser(this.tokens.hashToken(refreshToken));

    // ตอบสำเร็จแม้ไม่พบ token — logout ควร idempotent และการบอกว่า "ไม่พบ"
    // ก็ไม่ช่วยอะไรผู้ใช้
    if (stored && stored.revokedAt === null) {
      const count = await this.identity.revokeAllForUser(stored.userId);
      this.logger.log(`ยกเลิก refresh token ${count} ใบของ user ${stored.userId} — ผู้ใช้ออกจากระบบ`);
    }

    return okVoid();
  }

  /** /me ไม่ออก token ใหม่ — ส่งค่าว่างในช่อง token */
  async getCurrent(userId: string): Promise<Result<AuthResponse>> {
    const user = await this.identity.findUserById(userId);

    if (!user) {
      // token ยังไม่หมดอายุแต่ user ถูกลบไปแล้ว
      return err.unauthorized('ไม่พบผู้ใช้', 'user_not_found');
    }

    const memberships = await this.identity.listMemberships(userId);

    return ok({
      accessToken: '',
      accessTokenExpiresAt: EPOCH,
      refreshToken: '',
      refreshTokenExpiresAt: EPOCH,
      user: toUserDto(user),
      workspaces: memberships.map(toSummary),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════

  private async issueTokens(
    user: UserRow,
    client: ClientInfo,
    workspaces: WorkspaceSummaryDto[],
  ): Promise<AuthResponse> {
    const access = await this.tokens.createAccessToken(user);
    const refresh = this.tokens.createRefreshToken();

    await this.identity.addRefreshToken({
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
      userAgent: truncate(client.userAgent, 400),
      ipAddress: truncate(client.ipAddress, 45),
    });

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
      user: toUserDto(user),
      workspaces,
    };
  }
}

const INVALID_CREDENTIALS = err.unauthorized('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'invalid_credentials');

/** ตั้ง app.user_id ให้ธุรกรรมที่กำลังทำงานอยู่ — ดู TenantSession.enterIdentity */
async function enterIdentity(userId: string): Promise<void> {
  const session = currentSession();
  if (!session) throw new Error('login/register ถูกเรียกนอกธุรกรรม');
  await session.enterIdentity(userId);
}

const EPOCH = new Date(0).toISOString();

const toUserDto = (user: UserRow): UserDto => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatarUrl: user.avatarUrl,
  locale: user.locale,
  kind: user.kind,
});

const toSummary = (row: MembershipRow): WorkspaceSummaryDto => ({
  id: row.workspaceId,
  slug: row.slug,
  name: row.name,
  icon: row.icon,
  role: row.role,
});

const truncate = (value: string | null, max: number): string | null =>
  value === null || value.length <= max ? value : value.slice(0, max);
