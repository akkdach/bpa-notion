import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { loadEnv } from '../config/env.js';

// ═══════════════════════════════════════════════════════════════════════════
//  JWT · refresh token · API token
// ═══════════════════════════════════════════════════════════════════════════

export interface AccessToken {
  token: string;
  expiresAt: Date;
}

export interface RefreshTokenPair {
  /** ค่าจริงที่ส่งให้ client — ไม่มีที่ไหนเก็บไว้ */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface ApiTokenPair {
  token: string;
  tokenHash: string;
  last4: string;
}

export interface AccessTokenClaims {
  sub: string;
  email: string;
  name: string;
  jti: string;
}

/**
 * ⚠️ prefix `pmt_` มีโดยเจตนา สองเหตุผล:
 *
 *   1. แยกออกได้ทันทีว่านี่ไม่ใช่ JWT โดยไม่ต้องลอง verify ก่อน — ถ้าลอง
 *      verify JWT ก่อนแล้วค่อย fallback ทุก API token จะเสียเวลาไปกับการ
 *      validate ที่ล้มเหลวแน่นอน และ log จะเต็มไปด้วย token ผิดรูปที่ไม่ใช่ปัญหา
 *   2. เครื่องมือสแกนความลับใน git/log จับได้ด้วย pattern เดียว — token ที่
 *      หน้าตาเหมือน base64 ทั่วไปหลุดขึ้น repo แล้วไม่มีใครสังเกต
 */
export const API_TOKEN_PREFIX = 'pmt_';

@Injectable()
export class TokenService {
  private readonly issuer: string;
  private readonly accessLifetimeMs: number;
  readonly refreshLifetimeMs: number;

  constructor(private readonly jwt: JwtService) {
    const env = loadEnv();
    this.issuer = env.JWT_ISSUER;
    this.accessLifetimeMs = parseDuration(env.JWT_EXPIRES_IN, 24 * 60 * 60_000);
    this.refreshLifetimeMs = parseDuration(env.JWT_REFRESH_EXPIRES_IN, 30 * 24 * 60 * 60_000);
  }

  async createAccessToken(user: { id: string; email: string; name: string }): Promise<AccessToken> {
    const now = Date.now();
    const expiresAt = new Date(now + this.accessLifetimeMs);

    const token = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        // jti ทำให้ revoke token ใบเดียวได้ในอนาคต
        jti: randomBytes(16).toString('hex'),
      },
      {
        issuer: this.issuer,
        audience: this.issuer,
        notBefore: 0,
        expiresIn: Math.floor(this.accessLifetimeMs / 1000),
      },
    );

    return { token, expiresAt };
  }

  /**
   * ⚠️ ตรวจ issuer/audience/อายุ ครบทุกข้อ ไม่ใช่แค่ลายเซ็น
   *
   *    token ที่ลายเซ็นถูกแต่ issuer เป็นของระบบอื่นที่บังเอิญใช้ secret เดียวกัน
   *    จะผ่านทันทีถ้าตรวจแค่ลายเซ็น
   */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      return await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        issuer: this.issuer,
        audience: this.issuer,
      });
    } catch {
      // ไม่ log ที่นี่ — token หมดอายุเป็นเรื่องปกติที่เกิดทุกวัน การ log
      // ทุกครั้งทำให้ log จริงจมหาย ผู้เรียกเป็นคนตัดสินว่าควรบ่นไหม
      return null;
    }
  }

  createRefreshToken(): RefreshTokenPair {
    // 256 bit จาก CSPRNG — เดาไม่ได้ ไม่ต้องมีโครงสร้าง
    const token = base64Url(randomBytes(32));

    return {
      token,
      tokenHash: this.hashToken(token),
      expiresAt: new Date(Date.now() + this.refreshLifetimeMs),
    };
  }

  createApiToken(): ApiTokenPair {
    const token = API_TOKEN_PREFIX + base64Url(randomBytes(32));

    return {
      token,
      tokenHash: this.hashToken(token),
      last4: token.slice(-4),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  //  SHA-256 ไม่ใช่ argon2
  //
  //  ตั้งใจ: ต้อง lookup แถวในฐานด้วยค่านี้ จึงต้อง deterministic ซึ่ง argon2
  //  (ที่ salt ต่างกันทุกครั้ง) ทำไม่ได้ — ต้องดึงทุกแถวมา verify ทีละใบ
  //
  //  ปลอดภัยพอเพราะ token เป็น random 256 bit ไม่ใช่รหัสผ่านที่คนตั้ง
  //  ไม่มี dictionary ให้ brute force
  // ─────────────────────────────────────────────────────────────────────
  hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}

const base64Url = (bytes: Buffer): string => bytes.toString('base64url');

/**
 * แปลง "24h" / "30d" / "45m" / "90s" เป็นมิลลิวินาที
 * รูปแบบนี้ตรงกับ JWT_EXPIRES_IN ใน .env ที่ฝั่ง .NET ใช้อยู่แล้ว
 */
export function parseDuration(value: string | undefined, fallback: number): number {
  if (!value || value.trim() === '') return fallback;

  const text = value.trim();
  const unit = text.at(-1)?.toLowerCase() ?? '';

  if (!/[a-z]/.test(unit)) {
    // ไม่มีหน่วย — ตีความเป็นวินาที
    const seconds = Number(text);
    return Number.isInteger(seconds) && seconds > 0 ? seconds * 1000 : fallback;
  }

  const amount = Number(text.slice(0, -1));
  if (!Number.isInteger(amount) || amount <= 0) return fallback;

  const scale: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return (scale[unit] ?? 0) * amount || fallback;
}
