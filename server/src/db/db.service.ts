// ═══════════════════════════════════════════════════════════════════════════
//  DbService — ทางเดียวที่โค้ดในระบบแตะฐานข้อมูลได้
//
//  ⚠️ นี่คือจุดที่ tenant isolation ถูกบังคับใช้ หรือหลุด
//     (ที่เดิมคือ AppDbContext.ConfigureGlobalFilters ฝั่ง .NET)
//
//  ต่างจากของเดิมตรงที่การกรอง "ไม่ได้อยู่ในโค้ดนี้" — มันอยู่ใน RLS policy
//  ที่ sql/objects.sql หน้าที่ของไฟล์นี้มีอย่างเดียว: ตั้ง app.workspace_id
//  ให้ถูกต้องและตั้งแบบที่ไม่รั่วข้าม request
//
//  ผลพลอยได้ที่ของเดิมไม่มี: raw SQL ก็ถูกกรองด้วย ฝั่ง EF query filter มีผล
//  เฉพาะ query ที่ผ่าน LINQ เท่านั้น
// ═══════════════════════════════════════════════════════════════════════════

import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { loadEnv } from '../config/env.js';
import { schema } from './schema.js';

// ─────────────────────────────────────────────────────────────────────────
//  bigint → number
//
//  node-postgres คืน int8 เป็น "string" โดย default เพื่อไม่ให้ค่าเกิน
//  Number.MAX_SAFE_INTEGER เพี้ยนเงียบ ๆ แต่ schema ของเราประกาศ mode:'number'
//  ไว้ทุกคอลัมน์ int8 (seq, id ของ activity_logs, up_to_seq) จึงต้องแปลงที่นี่
//  ไม่งั้น type ที่ TypeScript บอกกับค่าที่ได้จริงจะไม่ตรงกัน
//
//  ⚠️ ปลอดภัยเพราะ 2^53 = 9,007,199,254,740,992 แถว ซึ่งไกลเกินกว่าตารางที่
//     โตเร็วที่สุด (page_doc_updates) จะไปถึงได้ — แผนบอกให้ partition
//     ตั้งแต่ ~50M แถวแล้ว
// ─────────────────────────────────────────────────────────────────────────
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));

export type Db = NodePgDatabase<typeof schema>;

/** ขอบเขตของธุรกรรมหนึ่ง — ค่าที่ถูกยิงเข้า GUC ก่อนแตะข้อมูล */
export interface Scope {
  /** tenant ปัจจุบัน — null สำหรับ flow ที่ยังไม่รู้ว่า workspace ไหน (login) */
  readonly workspaceId?: string | null;
  /** ผู้ใช้ที่ล็อกอินอยู่ — policy ของ workspaces/workspace_members ต้องใช้ */
  readonly userId?: string | null;
}

export interface TenantSession {
  readonly db: Db;
  /** ทางออกสำหรับ query ที่ Drizzle เขียนไม่ได้ (PGroonga, recursive CTE) */
  readonly client: pg.PoolClient;
  readonly scope: Scope;

  /**
   * ตั้ง tenant ระหว่างธุรกรรม — ใช้ตอนสร้าง workspace ใหม่เท่านั้น
   *
   * ขั้นตอนคือ INSERT workspaces (ผ่าน policy ด้วย created_by = ฉัน) แล้วจึง
   * enterWorkspace(newId) เพื่อให้ INSERT สมาชิก/หน้าแรกที่ตามมาผ่าน policy
   */
  enterWorkspace(workspaceId: string): Promise<void>;

  /**
   * ตั้งผู้ใช้ระหว่างธุรกรรม — ใช้ตอน login/register เท่านั้น
   *
   * ⚠️ ทั้งสอง endpoint เป็น @Public() ธุรกรรมจึงเปิดโดยยังไม่รู้ว่าใคร
   *    แต่พอ verify รหัสผ่านผ่านแล้ว เราต้องอ่าน "workspace ของฉัน" ต่อทันที
   *    ซึ่ง policy ของ workspaces/workspace_members ต้องการ app.user_id
   *
   *    ถ้าไม่เรียกตัวนี้ login จะสำเร็จแต่คืนรายการ workspace ว่างเสมอ —
   *    ผู้ใช้เข้าระบบได้แต่ไม่เห็นอะไรเลย (เทส auth.spec.ts จับข้อนี้ไว้)
   */
  enterIdentity(userId: string): Promise<void>;

  /**
   * รันงานที่ "ล้มได้โดยไม่ล้มทั้งธุรกรรม"
   *
   * ⚠️ ใน Postgres คำสั่งที่ error ทำให้ทั้งธุรกรรมเข้าสถานะ aborted — คำสั่ง
   *    ถัดไปทุกคำสั่งจะตอบ "current transaction is aborted" จนกว่าจะ rollback
   *
   *    แปลว่า pattern "ลอง INSERT ถ้าชนก็ลองชื่อใหม่" ใช้ไม่ได้เลยถ้าไม่มี
   *    savepoint และเป็นข้อจำกัดที่มองไม่เห็นจนกว่าจะเจอ error ที่ชี้ไปผิดที่
   *
   * ⚠️ ต้องใช้กับความล้มเหลวที่ "คาดไว้แล้ว" เท่านั้น (unique violation)
   *    ไม่ใช่กลบ error ทั่วไป — ผู้เรียกต้องโยนต่อถ้าไม่ใช่กรณีที่ตั้งใจดัก
   */
  savepoint<T>(fn: () => Promise<T>): Promise<T>;
}

const ambient = new AsyncLocalStorage<TenantSession>();

/** ชื่อ savepoint ต้องไม่ซ้ำกันเมื่อซ้อนกัน — ตัวนับต่อ process พอแล้ว */
let savepointCounter = 0;

/**
 * session ของธุรกรรมที่กำลังทำงานอยู่ — undefined เมื่อไม่ได้อยู่ใน withScope()
 *
 * มีไว้เพื่อไม่ต้องส่ง tx ผ่านทุก parameter ของทุก method ซึ่งเป็นทางที่
 * "ลืมส่งแล้วโค้ดยังคอมไพล์ผ่าน" — บั๊กแบบนั้นทำให้เขียนนอกธุรกรรมเงียบ ๆ
 */
export function currentSession(): TenantSession | undefined {
  return ambient.getStore();
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private readonly pool: pg.Pool;

  constructor() {
    const env = loadEnv();
    this.pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.assertRuntimeRoleIsSafe();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ประตูตอนบูต — RLS ที่ถูกข้ามจะ "ดูเหมือนผ่านหมด"
  //
  //  ถ้า runtime ต่อด้วย superuser หรือ role ที่มี BYPASSRLS ทุก policy ที่
  //  เขียนไว้จะไม่มีผลเลย และไม่มีอะไรในระบบส่งเสียง — ทุก query คืนข้อมูล
  //  ครบถ้วน ทุกเทสที่ใช้ tenant เดียวผ่านหมด แล้วข้อมูลข้าม workspace จะโผล่
  //  ให้เห็นก็ต่อเมื่อมีลูกค้าที่สอง
  //
  //  จึงตรวจที่ระดับ "คุณสมบัติของ role" ตอนบูต ไม่ใช่เชื่อว่าตั้งค่าถูก
  // ═══════════════════════════════════════════════════════════════════════
  private async assertRuntimeRoleIsSafe(): Promise<void> {
    const { rows } = await this.pool.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);

    const role = rows[0];
    if (!role) throw new Error('อ่านคุณสมบัติของ role ที่ใช้ต่อฐานไม่ได้');

    if (role.rolsuper || role.rolbypassrls) {
      throw new Error(
        `DATABASE_URL ต่อด้วย role "${role.rolname}" ซึ่ง${role.rolsuper ? 'เป็น superuser' : 'มี BYPASSRLS'} — ` +
          'RLS policy จะถูกข้ามทั้งหมดโดยไม่มีอาการอะไรเลย ให้ใช้ pm_app (ดู npm run db:setup)',
      );
    }

    this.logger.log(`ต่อฐานด้วย role ${role.rolname} (ไม่ใช่ superuser, ไม่มี BYPASSRLS)`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  withScope — ทางเข้าเดียวสู่ฐานข้อมูล
  //
  //  ⚠️ set_config(…, is_local = true) คือ SET LOCAL เขียนในรูปฟังก์ชันเพราะ
  //     SET รับ parameter ไม่ได้ (ต้องต่อสตริงเอง = ช่อง SQL injection)
  //
  //  ⚠️ is_local = true ขาดไม่ได้: ถ้าเป็น false ค่าจะติดค้างไปกับ connection
  //     หลัง release กลับ pool แล้ว request ถัดไปที่หยิบ connection เดิมจะเห็น
  //     tenant ของ request ก่อนหน้า — leak ที่เทสปกติจับไม่เจอ เพราะต้อง reuse
  //     connection ถึงจะโผล่ (ดู test/rls.spec.ts "ค่าไม่ติดค้างข้าม request")
  // ═══════════════════════════════════════════════════════════════════════
  async withScope<T>(scope: Scope, fn: (session: TenantSession) => Promise<T>): Promise<T> {
    const outer = ambient.getStore();
    if (outer) return this.joinOuter(outer, scope, fn);

    const client = await this.pool.connect();
    let poisoned = false;

    try {
      await client.query('BEGIN');
      await setScope(client, scope);

      // ⚠️ ต้องเป็น let: enterWorkspace/enterIdentity เปลี่ยนขอบเขตระหว่างทาง
      //    ถ้าอ่านจาก scope ตัวเดิมทุกครั้ง การเรียกตัวที่สองจะลบผลของตัวแรก
      let live = scope;
      const advance = async (next: Scope) => {
        live = next;
        await setScope(client, live);
      };

      const session: TenantSession = {
        client,
        db: drizzle(client, { schema }),
        get scope() {
          return live;
        },
        enterWorkspace: (workspaceId) => advance({ ...live, workspaceId }),
        enterIdentity: (userId) => advance({ ...live, userId }),
        savepoint: async <T>(fn: () => Promise<T>): Promise<T> => {
          const name = `sp_${(savepointCounter += 1)}`;
          await client.query(`SAVEPOINT ${name}`);

          try {
            const value = await fn();
            await client.query(`RELEASE SAVEPOINT ${name}`);
            return value;
          } catch (error) {
            await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
            throw error;
          }
        },
      };

      const result = await ambient.run(session, () => fn(session));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection พังไปแล้ว — คืนเข้า pool ไม่ได้ ต้องทิ้ง ไม่งั้น request
        // ถัดไปจะได้ connection ที่ค้างอยู่กลาง transaction
        poisoned = true;
      }
      throw error;
    } finally {
      client.release(poisoned);
    }
  }

  /** request ปกติ — รู้ทั้ง tenant และผู้ใช้ */
  withTenant<T>(workspaceId: string, userId: string | null, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.withScope({ workspaceId, userId }, fn);
  }

  /**
   * flow ที่รู้ว่าใครแต่ยังไม่รู้ว่า workspace ไหน
   * — รายการ workspace ของฉัน, สร้าง workspace ใหม่, /me
   */
  withIdentity<T>(userId: string, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.withScope({ userId }, fn);
  }

  /**
   * flow ที่ยังไม่รู้อะไรเลย — login, register, resolve api token
   *
   * ⚠️ ตารางที่มี RLS จะ "ว่างเปล่า" ในขอบเขตนี้ (fail closed) ใช้ได้เฉพาะกับ
   *    users / refresh_tokens / api_tokens ซึ่งไม่มี policy โดยเจตนา
   */
  withoutTenant<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.withScope({}, fn);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ธุรกรรมแยกที่ "ต้องอยู่รอด" แม้ request จะล้มเหลว
  //
  //  ⚠️ ราคาที่ซ่อนอยู่ในดีไซน์ "หนึ่ง request หนึ่งธุรกรรม": ทางที่จบด้วย
  //     ความล้มเหลวจะ rollback ทุกอย่าง รวมถึงสิ่งที่เราตั้งใจเขียนตอนล้มเหลว
  //
  //     เจอจริงตอนพอร์ต auth: การตรวจพบ refresh token ถูกใช้ซ้ำต้อง "ยกเลิก
  //     ทุก session ของ user นั้น" แล้วตอบ 401 — แต่ 401 มาจากการ throw ซึ่ง
  //     ทำให้การยกเลิกถูก rollback ไปด้วย ผลคือระบบตรวจเจอว่า token รั่วแล้ว
  //     ประกาศว่าจะล้าง session แต่ไม่ได้ล้างอะไรเลย และไม่มีอาการอะไรให้เห็น
  //     (เทส "ใช้ใบที่ rotate ไปแล้วซ้ำ" ใน auth.spec.ts จับข้อนี้ไว้)
  //
  //  ใช้กับ side effect ที่ต้องคงอยู่ข้ามความล้มเหลวเท่านั้น — การเพิกถอน,
  //  ตัวนับ rate limit, audit ของการเข้าถึงที่ถูกปฏิเสธ
  //  ❌ ห้ามใช้เพื่อ "เลี่ยง" การ rollback ของงานปกติ
  //
  //  ⚠️ ตัวนี้ยืม connection ที่สองมาระหว่างที่ตัวแรกยังถืออยู่ ถ้าเรียกใน
  //     ทางที่วิ่งบ่อย pool จะหมดเร็วเป็นสองเท่า — ทางที่ใช้อยู่ตอนนี้เกิดเฉพาะ
  //     ตอนตรวจพบ token รั่ว ซึ่งควรจะแทบไม่เกิดเลย
  // ═══════════════════════════════════════════════════════════════════════
  async withOwnTransaction<T>(scope: Scope, fn: (session: TenantSession) => Promise<T>): Promise<T> {
    // exit() ทำให้โค้ดข้างในมองไม่เห็น session ปัจจุบัน — withScope จึงเปิด
    // connection ใหม่แทนที่จะไปรวมกับธุรกรรมที่กำลังจะ rollback
    return ambient.exit(() => this.withScope(scope, fn));
  }

  /**
   * ธุรกรรมซ้อน = ธุรกรรมเดียวกัน ไม่ใช่ connection ใหม่
   *
   * ถ้าเปิด connection ใหม่ซ้อนเข้าไป จะได้ทั้ง deadlock กับตัวเอง และการ
   * COMMIT บางส่วนเมื่อชั้นนอก rollback
   */
  private async joinOuter<T>(
    outer: TenantSession,
    scope: Scope,
    fn: (s: TenantSession) => Promise<T>,
  ): Promise<T> {
    const wantsWorkspace = scope.workspaceId ?? null;
    const hasWorkspace = outer.scope.workspaceId ?? null;

    if (wantsWorkspace !== null && wantsWorkspace !== hasWorkspace) {
      throw new Error(
        `withScope ซ้อนกันด้วย workspace คนละอัน (ข้างนอก ${hasWorkspace ?? 'ไม่มี'} → ข้างใน ${wantsWorkspace}) — ` +
          'ธุรกรรมเดียวข้าม tenant ไม่ได้ ให้แยกเป็นคนละธุรกรรม',
      );
    }

    return fn(outer);
  }

  /**
   * connection ที่อยู่ "นอก" ธุรกรรมและนอกขอบเขต tenant ทั้งหมด
   *
   * ⚠️ ห้ามใช้อ่านหรือเขียนข้อมูลของ tenant เด็ดขาด — ไม่มี app.workspace_id
   *    ตั้งไว้ ทุกตารางที่มี RLS จะว่างเปล่า และตารางที่ไม่มี RLS จะเห็นทั้งหมด
   *
   * ใช้ได้สองอย่างเท่านั้น:
   *   · ตรวจคุณสมบัติของ role ตอนบูต (assertRuntimeRoleIsSafe)
   *   · เทสที่ต้องพิสูจน์ว่าไม่มีค่าค้างบน connection หลัง COMMIT
   *     — ซึ่งพิสูจน์จากในขอบเขต withScope ไม่ได้ เพราะ withScope เขียนทับ
   *       ค่าใหม่ทุกครั้งที่เปิดธุรกรรม จึงกลบอาการพอดี
   */
  get unscopedPool(): pg.Pool {
    return this.pool;
  }

  /** ให้เทสปิด pool ได้โดยไม่ต้องยก Nest ทั้งก้อน */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * ⚠️ ทั้งสองค่าต้องถูกตั้งเสมอ แม้จะเป็น '' — ไม่ใช่ "ตั้งเฉพาะตอนมีค่า"
 *
 *    connection ที่ถูก reuse อาจมีค่าค้างจากธุรกรรมก่อนหน้าใน session
 *    (SET LOCAL คืนค่าเดิมตอนจบ transaction ซึ่ง "ค่าเดิม" ของ connection ที่
 *    เคยใช้มาแล้วคือ '' ไม่ใช่ unset) การเขียนทับด้วย '' ทุกครั้งจึงเป็นสิ่งที่
 *    ทำให้ขอบเขตของธุรกรรมนี้เป็นของธุรกรรมนี้จริง ๆ
 *
 *    app_current_workspace() แปลง '' เป็น NULL ให้แล้ว ซึ่งทำให้ policy
 *    เป็นเท็จทั้งหมด = ไม่เห็นแถวไหนเลย
 */
async function setScope(client: pg.PoolClient, scope: Scope): Promise<void> {
  await client.query('SELECT set_config($1, $2, true), set_config($3, $4, true)', [
    'app.workspace_id',
    scope.workspaceId ?? '',
    'app.user_id',
    scope.userId ?? '',
  ]);
}
