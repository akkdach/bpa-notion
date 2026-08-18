import { Injectable } from '@nestjs/common';

import { DbService } from '../db/db.service.js';

/**
 * extension ที่ระบบต้องมีจริง ๆ ถึงจะทำงานได้
 *
 * ⚠️ ตรวจ pgroonga ด้วยเป็นเรื่องสำคัญ ไม่ใช่ของประดับ — ถ้ามีคนสลับ image กลับ
 *    ไปเป็น postgres ธรรมดา ระบบจะต่อฐานได้ปกติทุกอย่าง แต่การค้นหาพังเงียบ ๆ
 *    ซึ่งเป็นความพังที่สังเกตยากที่สุด
 */
export const REQUIRED_EXTENSIONS = ['pgroonga', 'pgcrypto', 'citext'] as const;

export interface DatabaseProbe {
  canConnect: boolean;
  latencyMs: number;
  serverVersion: string | null;
  extensions: string[];
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HealthRepository
//
//  ⚠️ เป็นที่เดียวที่ใช้ unscopedPool นอก DbService โดยเจตนา — health ตอบได้
//     แม้ยังไม่ล็อกอิน จึงไม่มี tenant ให้ตั้ง และไม่ได้อ่านข้อมูลของใครเลย
//     (scripts/check-architecture.mjs อนุญาตไฟล์นี้ไว้เป็นข้อยกเว้นที่ระบุชื่อ)
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class HealthRepository {
  constructor(private readonly db: DbService) {}

  async probe(): Promise<DatabaseProbe> {
    const started = Date.now();

    try {
      // query จริง ไม่ใช่แค่ "ต่อได้ไหม" — เอา version กับรายการ extension มาด้วย
      const result = await this.db.unscopedPool.query<{ version: string; extensions: string[] }>(
        `SELECT current_setting('server_version') AS version,
                COALESCE(
                    (SELECT array_agg(extname::text ORDER BY extname::text)
                       FROM pg_extension
                      WHERE extname::text = ANY($1::text[])),
                    '{}'::text[]
                ) AS extensions`,
        [[...REQUIRED_EXTENSIONS]],
      );

      const row = result.rows[0];

      return {
        canConnect: row !== undefined,
        latencyMs: Date.now() - started,
        serverVersion: row?.version ?? null,
        extensions: row?.extensions ?? [],
      };
    } catch (error) {
      return {
        canConnect: false,
        latencyMs: Date.now() - started,
        serverVersion: null,
        extensions: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
