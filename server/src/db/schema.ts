// ═══════════════════════════════════════════════════════════════════════════
//  schema — รูปของฐานข้อมูลที่ Drizzle เขียนได้
//
//  ⚠️ ไฟล์นี้ "ไม่ใช่" รูปเต็มของฐาน สิ่งที่ Drizzle เขียนไม่ได้อยู่ที่
//     sql/objects.sql ทั้งหมด: CHECK constraint, partial index, GIN opclass,
//     PGroonga tokenizer, COLLATE "C", ON DELETE SET NULL (column list)
//     และ RLS policy
//
//     อ่านสองไฟล์คู่กันเสมอ ไฟล์เดียวไม่พอ
//
//  ⚠️ tenant isolation ไม่ได้อยู่ที่นี่และไม่ได้อยู่ใน repository — อยู่ที่
//     RLS policy ใน sql/objects.sql ดู db.service.ts สำหรับวิธีตั้งค่า
// ═══════════════════════════════════════════════════════════════════════════

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────
//  ชนิดที่ Drizzle ไม่มีให้ในตัว
// ─────────────────────────────────────────────────────────────────────────

/**
 * citext — unique แบบไม่สนตัวพิมพ์ โดยไม่ต้องมี lower() index กระจายทุก query
 *
 * ⚠️ ต้อง `CREATE EXTENSION citext` ก่อน — อยู่ใน db/init/001_extensions.sql
 *    ซึ่งรันครั้งเดียวตอน container เกิดใหม่เท่านั้น
 */
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** bytea — Yjs update/snapshot เป็นก้อนทึบที่เซิร์ฟเวอร์ไม่แกะ */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * timestamptz ที่คืนค่าเป็น string ISO ไม่ใช่ Date
 *
 * `mode: 'string'` เพราะ Date ของ JS ทิ้ง offset และเก็บได้แค่ระดับมิลลิวินาที
 * ขณะที่ Postgres เก็บถึงไมโครวินาที — การแปลงกลับไปกลับมาทำให้ค่าเพี้ยน
 * เงียบ ๆ ในการเทียบเวลา (เช่น ORDER BY created_at ที่มีสองแถวในมิลลิเดียวกัน)
 */
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

const now = sql`now()`;
const newUuid = sql`gen_random_uuid()`;

// ═══════════════════════════════════════════════════════════════════════════
//  identity — ไม่ผูก workspace จึงไม่มี RLS policy
// ═══════════════════════════════════════════════════════════════════════════

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(newUuid),
    email: citext('email').notNull(),
    passwordHash: varchar('password_hash', { length: 120 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    avatarUrl: varchar('avatar_url', { length: 1000 }),
    locale: varchar('locale', { length: 10 }).notNull().default('th'),

    /**
     * คนหรือ AI — ทำให้ตอบได้ว่า "หน้านี้ AI แก้หรือฉันแก้"
     *
     * ⚠️ ไม่ใช่ระดับสิทธิ์ — agent ได้สิทธิ์จาก workspace_members เหมือนคนทุกอย่าง
     *    default ต้องอยู่ที่ระดับฐานด้วย ไม่ใช่แค่ในโค้ด เพราะบัญชีที่ INSERT
     *    จาก psql มือเปล่าต้องได้ 'human' ไม่ใช่ NULL
     */
    kind: varchar('kind', { length: 20 }).notNull().default('human'),

    createdAt: tstz('created_at').notNull().default(now),
    lastLoginAt: tstz('last_login_at'),
  },
  (t) => [uniqueIndex('ux_users_email').on(t.email)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().default(newUuid),

    /** ใช้ใน URL: /w/{slug} — รูปแบบถูกบังคับด้วย ck_workspaces_slug_format */
    slug: varchar('slug', { length: 60 }).notNull(),

    name: varchar('name', { length: 200 }).notNull(),
    icon: varchar('icon', { length: 200 }),
    createdBy: uuid('created_by').notNull(),
    createdAt: tstz('created_at').notNull().default(now),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [uniqueIndex('ux_workspaces_slug').on(t.slug), index('ix_workspaces_deleted_at').on(t.deletedAt)],
);

/**
 * สมาชิกของ workspace — ไม่มีตาราง invite เพราะไม่ได้ใช้อีเมลเชิญ
 * (ไม่มี SMTP dependency) admin เพิ่มสมาชิกด้วยอีเมลของ user ที่สมัครไว้แล้ว
 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull(),
    joinedAt: tstz('joined_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ name: 'pk_workspace_members', columns: [t.workspaceId, t.userId] }),
    // "workspace ของฉัน" — อ่านจากฝั่ง user ซึ่ง PK ช่วยไม่ได้ (user_id อยู่หลัง)
    index('ix_workspace_members_user_id').on(t.userId),
  ],
);

/**
 * refresh token — เก็บเฉพาะ SHA-256 hash ไม่เก็บค่าจริง
 * ถ้าฐานข้อมูลรั่ว ผู้ที่ได้ไปยังสวมสิทธิ์ไม่ได้
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().default(newUuid),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** SHA-256 hex = 64 ตัวเสมอ · ไม่ใช้ argon2 เพราะต้อง lookup ด้วยค่านี้ จึงต้อง deterministic */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),

    expiresAt: tstz('expires_at').notNull(),
    createdAt: tstz('created_at').notNull().default(now),
    revokedAt: tstz('revoked_at'),

    /** token ที่ออกแทนตัวนี้ตอน rotate — ใช้ตรวจจับการใช้ token ซ้ำ */
    replacedByTokenId: uuid('replaced_by_token_id'),

    userAgent: varchar('user_agent', { length: 400 }),

    // varchar(45) ไม่ใช่ inet — ไม่ได้ query แบบ subnet เลย
    // (45 = ความยาวสูงสุดของ IPv6 แบบมี IPv4 ต่อท้าย)
    ipAddress: varchar('ip_address', { length: 45 }),
  },
  (t) => [
    uniqueIndex('ux_refresh_tokens_token_hash').on(t.tokenHash),
    index('ix_refresh_tokens_user_id_expires_at').on(t.userId, t.expiresAt),
  ],
);

/**
 * ApiToken — กุญแจให้เครื่องภายนอก (MCP server) เข้าถึง workspace หนึ่ง
 *
 * ⚠️ ไม่มี RLS policy โดยเจตนา — การ resolve token เกิด "ก่อน" ที่ระบบจะรู้ว่า
 *    request นี้อยู่ workspace ไหน (workspace มาจากตัว token เอง) ถ้าเปิด RLS
 *    ไว้ การ lookup จะไม่เจออะไรเลยเพราะ app.workspace_id ยังไม่ถูกตั้ง
 *
 *    ขอบเขตจึงถูกจำกัดที่ workspace_id ซึ่งผูกกับใบ ไม่ใช่มาจาก header:
 *    บัญชี AI เป็นสมาชิกหลาย workspace ได้ แต่ token หนึ่งใบใช้ได้ workspace เดียว
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().default(newUuid),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    /** บัญชีที่ token นี้ทำงานแทน — ทุกอย่างถูกบันทึกว่าบัญชีนี้เป็นคนทำ */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 100 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),

    /** สี่ตัวท้ายของค่าจริง — ไม่ใช่ความลับ เดาส่วนที่เหลืออีก 252 บิตจากนี้ไม่ได้ */
    last4: varchar('last4', { length: 8 }).notNull(),

    /** ใครเป็นคนสร้าง (owner/admin) — คนละคนกับ userId ที่ token ทำงานแทน */
    createdBy: uuid('created_by'),

    createdAt: tstz('created_at').notNull().default(now),

    /** null = ไม่มีวันหมดอายุ */
    expiresAt: tstz('expires_at'),

    /** อัปเดตแบบหน่วง ไม่ใช่ทุก request — เขียนทุก request คือเขียนต่อทุกการอ่าน */
    lastUsedAt: tstz('last_used_at'),

    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    uniqueIndex('ux_api_tokens_token_hash').on(t.tokenHash),
    index('ix_api_tokens_workspace_id_created_at').on(t.workspaceId, t.createdAt),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════
//  pages — แถวใน database ก็เป็น page (kind = db_row)
//
//  เนื้อหาของหน้าอยู่ใน Yjs blob (page_doc_updates / page_doc_snapshots)
//  ตารางนี้เก็บเฉพาะ metadata + projection ที่ client ส่งกลับมา
// ═══════════════════════════════════════════════════════════════════════════

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().default(newUuid),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    parentId: uuid('parent_id'),

    /**
     * root..parent เรียงจากบนลงล่าง มี GIN index (sql/objects.sql)
     *
     * เป็น read optimization — parentId คือความจริง (มี FK บังคับ)
     * ย้าย subtree 500 หน้า = UPDATE เดียวด้วย `ancestor_ids @> ARRAY[id]`
     */
    ancestorIds: uuid('ancestor_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),

    depth: integer('depth').notNull().default(0),

    /**
     * fractional index — แทรกระหว่างเพื่อนบ้าน = เขียนแถวเดียว ไม่ต้อง renumber
     *
     * ⚠️ คอลัมน์นี้ต้องเป็น COLLATE "C" ซึ่ง Drizzle เขียนไม่ได้ → sql/objects.sql
     *    ฐานนี้ตั้ง ICU th-TH เป็น collation หลัก ถ้าไม่บังคับ ORDER BY rank
     *    จะให้ลำดับที่ไม่ตรงกับที่ generateKeyBetween คำนวณไว้
     *
     * ⚠️ rank ชนกันได้ตามปกติ — ห้ามทำ unique index บน (parent_id, rank)
     *    และต้อง ORDER BY rank, id เสมอ
     */
    rank: varchar('rank', { length: 200 }).notNull(),

    kind: varchar('kind', { length: 20 }).notNull(),

    /** ไม่ null เมื่อ kind = db_row (บังคับด้วย ck_pages_db_row_has_database) */
    databaseId: uuid('database_id'),

    /** projection จาก Yjs — client ส่งมาหลังหยุดพิมพ์ 2 วินาที */
    title: text('title').notNull().default(''),

    icon: varchar('icon', { length: 200 }),
    coverUrl: varchar('cover_url', { length: 1000 }),

    /** todo / doing / done — null = หน้านี้ไม่ใช่ "งาน" ซึ่งเป็นค่าที่พบบ่อยที่สุด */
    status: varchar('status', { length: 20 }),

    /** ค่า property ของแถว database — key เป็น property UUID */
    properties: jsonb('properties'),

    /** ผล formula / rollup ที่ materialise ไว้ให้ filter และ sort ได้ */
    computed: jsonb('computed'),

    /**
     * ancestor-or-self ที่ใกล้สุดซึ่งมี page_acl ของตัวเอง
     *
     * ⚠️ ค่านี้เพี้ยน = บั๊กเรื่องสิทธิ์ ซึ่งเป็นบั๊กที่แย่ที่สุด
     */
    accessRootId: uuid('access_root_id').notNull(),

    archivedAt: tstz('archived_at'),
    deletedAt: tstz('deleted_at'),

    createdBy: uuid('created_by'),
    lastEditedBy: uuid('last_edited_by'),
    createdAt: tstz('created_at').notNull().default(now),
    updatedAt: tstz('updated_at').notNull().default(now),
  },
  (t) => [
    // ─────────────────────────────────────────────────────────────────────
    //  ⚠️ unique (workspace_id, id) มีไว้เพื่อให้ตารางลูกอ้าง composite FK ได้
    //
    //  เมื่อ page_doc_updates (workspace_id, page_id) → pages (workspace_id, id)
    //  การอ้างข้าม workspace จะ "เป็นไปไม่ได้" ไม่ใช่แค่ "ไม่น่าเกิด"
    //  เพิ่มตอนนี้ราคาถูก ย้อนกลับมาเพิ่มทีหลังแทบไม่ได้
    // ─────────────────────────────────────────────────────────────────────
    unique('ux_pages_workspace_id_id').on(t.workspaceId, t.id),

    // self-FK แบบ composite — ลูกต้องอยู่ workspace เดียวกับพ่อเสมอ
    // restrict เพราะการลบทำผ่าน soft-delete เท่านั้น
    foreignKey({
      name: 'fk_pages_parent',
      columns: [t.workspaceId, t.parentId],
      foreignColumns: [t.workspaceId, t.id],
    }).onDelete('restrict'),

    index('ix_pages_workspace_id_access_root_id').on(t.workspaceId, t.accessRootId),

    // ⚠️ index อีก 5 ตัวของตารางนี้อยู่ใน sql/objects.sql เพราะเป็น partial
    //    หรือ GIN: ix_pages_sidebar, ix_pages_ancestor_ids_gin,
    //    ix_pages_database_rows, ix_pages_properties_gin, ix_pages_computed_gin,
    //    ix_pages_trash
  ],
);

/**
 * สิทธิ์ระดับหน้า
 *
 * หน้าที่ "ไม่มี" แถวที่นี่ = สืบทอดสิทธิ์จาก ancestor
 * หน้าที่ "มี" แถว = เป็น access root และหยุดการสืบทอด (nearest-ancestor-wins)
 */
export const pageAcls = pgTable(
  'page_acls',
  {
    pageId: uuid('page_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    subjectType: varchar('subject_type', { length: 20 }).notNull(),

    /**
     * ⚠️ เป็น uuid ว่าง (ไม่ใช่ null) เมื่อ subjectType = 'workspace'
     *    เพราะคอลัมน์นี้เป็นส่วนของ primary key และ Postgres ไม่ยอมให้
     *    คอลัมน์ใน PK เป็น NULL — บังคับคู่กันด้วย ck_page_acls_subject_id
     */
    subjectId: uuid('subject_id').notNull(),

    role: varchar('role', { length: 20 }).notNull(),
    grantedBy: uuid('granted_by'),
    grantedAt: tstz('granted_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ name: 'pk_page_acls', columns: [t.pageId, t.subjectType, t.subjectId] }),
    foreignKey({
      name: 'fk_page_acls_pages',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }).onDelete('cascade'),
    // ⚠️ ของเดิมมี index (page_id, subject_type, subject_id) แยกอีกตัว ซึ่งซ้ำกับ
    //    PK ข้างบนทุกคอลัมน์และเรียงลำดับเดียวกันเป๊ะ — index ที่ซ้ำสนิทกิน write
    //    throughput ฟรี ๆ จึงไม่ยกมา
  ],
);

// ═══════════════════════════════════════════════════════════════════════════
//  Yjs storage + projection ที่ client ส่งกลับมา
//
//  ทั้งสี่ตารางอ้าง pages ด้วย composite FK (workspace_id, page_id)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Yjs update log — append-only เซิร์ฟเวอร์ "ไม่แกะ" ก้อนนี้เลย
 *
 * ⚠️ จะเป็นตารางที่มีจำนวนแถวมากที่สุดในระบบ (~1 update ต่อ keystroke
 *    ถ้าไม่มี batching) เกิน ~50M แถวให้พิจารณา PARTITION BY HASH (page_id)
 */
export const pageDocUpdates = pgTable(
  'page_doc_updates',
  {
    /** ลำดับที่ client ใช้ bootstrap และใช้ตัดสินว่า compact ถึงไหน */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),

    workspaceId: uuid('workspace_id').notNull(),
    pageId: uuid('page_id').notNull(),

    // ชื่อคอลัมน์เป็น update_data ไม่ใช่ update เพราะ UPDATE เป็น reserved keyword
    // ของ Postgres — ตารางนี้มี raw SQL แน่ ๆ จึงไม่คุ้มที่จะเสี่ยงลืม quote
    updateData: bytea('update_data').notNull(),

    /** Yjs clientID ของผู้ส่ง — ใช้เลือกว่าใครเป็นคน compact */
    yClientId: bigint('y_client_id', { mode: 'number' }),

    authorUserId: uuid('author_user_id'),
    createdAt: tstz('created_at').notNull().default(now),
  },
  (t) => [
    foreignKey({
      name: 'fk_page_doc_updates_pages',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }).onDelete('cascade'),
    // access path เดียวของตารางนี้: อ่าน update ของหน้าหนึ่งเรียงตาม seq
    index('ix_page_doc_updates_page_id_seq').on(t.pageId, t.seq),
  ],
);

/**
 * snapshot ของ Yjs document — client เป็นคนสร้างและส่งมา
 * (`Y.encodeStateAsUpdate(doc)`) เพราะเซิร์ฟเวอร์ merge CRDT เองไม่ได้
 *
 * ⚠️ นี่คือ trust boundary: client ที่ "มีบั๊ก" (ไม่ต้องถึงขั้นมุ่งร้าย) ส่ง
 *    snapshot ที่ข้อมูลหายมาได้
 */
export const pageDocSnapshots = pgTable(
  'page_doc_snapshots',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    pageId: uuid('page_id').notNull(),

    snapshot: bytea('snapshot').notNull(),

    /** snapshot นี้ครอบคลุม update ถึง seq ไหน */
    upToSeq: bigint('up_to_seq', { mode: 'number' }).notNull(),

    /** เก็บแยกไว้เพื่อเทียบขนาดกับ snapshot ก่อนหน้า (guard กัน snapshot ที่หายข้อมูล) */
    byteSize: integer('byte_size').notNull(),

    /**
     * ใช้เสิร์ฟ bootstrap ได้หรือไม่
     *
     * ⚠️ คอลัมน์นี้เกิดจากบั๊กที่เทสจับได้: การ "เก็บไว้แต่ไม่ prune" อย่างเดียว
     *    ไม่พอ เพราะ bootstrap หยิบ snapshot ที่ up_to_seq สูงสุดมาเสิร์ฟ แล้ว
     *    ข้าม update ที่เก่ากว่าไปหมด ผลคือข้อมูลยังอยู่ในฐานแต่ผู้ใช้เห็นหน้าว่าง
     */
    isTrusted: boolean('is_trusted').notNull().default(true),

    createdBy: uuid('created_by'),
    createdAt: tstz('created_at').notNull().default(now),
  },
  (t) => [
    foreignKey({
      name: 'fk_page_doc_snapshots_pages',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }).onDelete('cascade'),

    // กัน snapshot ซ้ำที่จุดเดียวกัน (สอง client ได้รับคำสั่ง compact พร้อมกัน)
    // ⚠️ index นี้รับหน้าที่ "หา snapshot ล่าสุดของหน้านี้" ด้วย — Postgres
    //    สแกน btree ถอยหลังได้ จึงไม่ต้องมี (page_id, up_to_seq DESC) แยกอีกตัว
    uniqueIndex('ux_page_doc_snapshots_page_id_up_to_seq').on(t.pageId, t.upToSeq),
  ],
);

/**
 * projection สำหรับค้นหา — เป็นข้อมูล derived ทั้งหมด สร้างใหม่ได้เสมอ
 *
 * ⚠️ PGroonga index บนตารางนี้ "ต้อง" ระบุ tokenizer เป็น bigram (sql/objects.sql)
 *    ค่า default ตัดคำด้วยช่องว่าง ซึ่งกับภาษาไทยแปลว่าค้นเจอเฉพาะคำที่เป็น
 *    prefix ของทั้งประโยค
 */
export const pageSearches = pgTable(
  'page_searches',
  {
    pageId: uuid('page_id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),

    /** denormalise มาที่นี่เพื่อกรองสิทธิ์ใน query เดียว ไม่ต้องเช็คทีละผลลัพธ์ */
    accessRootId: uuid('access_root_id').notNull(),

    databaseId: uuid('database_id'),

    title: text('title').notNull().default(''),
    bodyText: text('body_text').notNull().default(''),

    /** generated column — Postgres คำนวณให้ อ่านได้แต่เขียนไม่ได้ */
    searchText: text('search_text').generatedAlwaysAs(sql`title || ' ' || body_text`),

    updatedAt: tstz('updated_at').notNull().default(now),
  },
  (t) => [
    foreignKey({
      name: 'fk_page_searches_pages',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }).onDelete('cascade'),
    index('ix_page_searches_workspace_id_access_root_id').on(t.workspaceId, t.accessRootId),
  ],
);

/**
 * ลิงก์จากหน้าหนึ่งไปอีกหน้าหนึ่ง (`@page` mention ในเนื้อหา) — derived เหมือน
 * page_searches ทางอ่านที่สำคัญคือ "ย้อนกลับ": หน้านี้ถูกอ้างถึงจากที่ไหนบ้าง
 */
export const pageLinks = pgTable(
  'page_links',
  {
    workspaceId: uuid('workspace_id').notNull(),
    sourcePageId: uuid('source_page_id').notNull(),
    targetPageId: uuid('target_page_id').notNull(),
    updatedAt: tstz('updated_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ name: 'pk_page_links', columns: [t.sourcePageId, t.targetPageId] }),

    // ─────────────────────────────────────────────────────────────────────
    //  composite FK ทั้งสองฝั่ง — ลิงก์ข้าม workspace จึง "เขียนลงฐานไม่ได้"
    //
    //  ⚠️ ข้อห้าม "multiple cascade path มาที่ตารางเดียวกัน" เป็นข้อจำกัดของ
    //     SQL Server ไม่ใช่ PostgreSQL — ถ้าเผลอตั้งฝั่ง target เป็น NoAction
    //     เพราะกลัวข้อจำกัดนั้น ผลคือ "ลบหน้าที่มีคนลิงก์มาไม่ได้เลย"
    // ─────────────────────────────────────────────────────────────────────
    foreignKey({
      name: 'fk_page_links_source',
      columns: [t.workspaceId, t.sourcePageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_page_links_target',
      columns: [t.workspaceId, t.targetPageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }).onDelete('cascade'),

    index('ix_page_links_workspace_id_target_page_id').on(t.workspaceId, t.targetPageId),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════
//  การทำงานร่วมกันระหว่างคนกับ AI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * บันทึกสั้น ๆ ต่อท้ายหน้า (append-only) — ช่องให้ AI เขียนข้อความเป็นภาษาคน
 * โดยไม่ต้องแตะ Yjs ซึ่งเซิร์ฟเวอร์เขียนเองไม่ได้อย่างปลอดภัย
 *
 * ⚠️ append-only โดยเจตนา ไม่มี updatedAt และไม่มีทางแก้
 *    บันทึกที่แก้ย้อนหลังได้ไม่ใช่บันทึก — ถ้า AI เขียนผิดให้เขียนใหม่ต่อท้าย
 */
export const pageNotes = pgTable(
  'page_notes',
  {
    id: uuid('id').primaryKey().default(newUuid),
    workspaceId: uuid('workspace_id').notNull(),
    pageId: uuid('page_id').notNull(),

    /** null เมื่อบัญชีผู้เขียนถูกลบไปแล้ว — บันทึกยังต้องอ่านได้ */
    authorUserId: uuid('author_user_id'),

    // ยาวพอสำหรับบันทึกความคืบหน้าหรือสรุปย่อ แต่ไม่ใช่ที่เก็บเอกสาร
    // — ถ้า AI อยากเขียนยาวกว่านี้ มันควรเขียนลงหน้าจริง ไม่ใช่ลงบันทึก
    body: varchar('body', { length: 4000 }).notNull(),

    createdAt: tstz('created_at').notNull().default(now),
  },
  (t) => [
    // CASCADE ถูกต้องที่นี่: บันทึกของหน้าที่ถูกลบถาวรไม่มีความหมายอีก
    // (ต่างจาก activity_logs ที่ต้องเก็บไว้เป็นหลักฐาน)
    foreignKey({
      name: 'fk_page_notes_pages',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }).onDelete('cascade'),
    index('ix_page_notes_workspace_id_page_id_created_at').on(t.workspaceId, t.pageId, t.createdAt),
  ],
);

/**
 * ใครทำอะไรกับหน้าไหนเมื่อไหร่
 *
 * ⚠️ ต้องเขียนใน "ธุรกรรมเดียวกับการเปลี่ยนแปลง" ไม่ใช่หลังจากนั้น
 *    ไม่งั้น log จะโกหก: มีแถวบอกว่าเปลี่ยนแล้วแต่ข้อมูลไม่ได้เปลี่ยน หรือกลับกัน
 *
 * ⚠️ ห้ามใส่ CHECK บน action โดยเจตนา — log คือข้อมูลประวัติศาสตร์ แถวที่เขียน
 *    ไปแล้วต้องอ่านได้ตลอดไปแม้โค้ดใหม่เลิกผลิต action นั้น constraint จะทำให้
 *    ลบ action เก่าออกจากโค้ดไม่ได้เลย เป็นข้อยกเว้นเดียวจาก enum อื่นทั้งระบบ
 */
export const activityLogs = pgTable(
  'activity_logs',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),

    /** null เมื่อหน้าถูกลบถาวรไปแล้ว (ON DELETE SET NULL เฉพาะคอลัมน์นี้) */
    pageId: uuid('page_id'),

    /**
     * สำเนาชื่อหน้าตอนเกิดเหตุ — ไม่ใช่ denormalise เพื่อความเร็ว
     * เก็บเพราะ (ก) หน้าอาจถูกลบถาวรแล้ว และ (ข) ชื่อหน้าเปลี่ยนได้
     */
    pageTitle: varchar('page_title', { length: 400 }).notNull(),

    actorUserId: uuid('actor_user_id'),
    action: varchar('action', { length: 40 }).notNull(),

    /** มี "v" เป็นเวอร์ชันของ schema ตั้งแต่แถวแรก · เก็บค่าเดิม (from) ไว้ด้วยเสมอ */
    detail: jsonb('detail'),

    createdAt: tstz('created_at').notNull().default(now),
  },
  (t) => [
    // ─────────────────────────────────────────────────────────────────────
    //  ⚠️ FK นี้ถูก DROP แล้ว ADD ใหม่ใน sql/objects.sql
    //
    //  ต้องเป็น ON DELETE SET NULL (page_id) แบบระบุคอลัมน์ (PostgreSQL 15+)
    //  ไม่ใช่ SET NULL เปล่า ๆ ที่ Drizzle เขียนได้ — SET NULL แบบไม่ระบุคอลัมน์
    //  จะเซ็ต workspace_id ที่เป็น NOT NULL เป็น NULL ด้วย ทำให้ purge หน้าที่มี
    //  ประวัติล้มด้วย not-null violation = ลบถาวรไม่ได้เลย
    // ─────────────────────────────────────────────────────────────────────
    foreignKey({
      name: 'fk_activity_logs_pages',
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }).onDelete('set null'),

    // ฟีดกิจกรรมอ่านย้อนเวลาเสมอ — ตรงกับ ORDER BY created_at DESC, id DESC
    index('ix_activity_logs_workspace_id_created_at').on(t.workspaceId, t.createdAt),
    // "ประวัติของหน้านี้" ในแผงข้างหน้า
    index('ix_activity_logs_workspace_id_page_id_created_at').on(t.workspaceId, t.pageId, t.createdAt),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════
//  ตารางที่อยู่ใต้ RLS
//
//  ⚠️ รายการนี้ต้องตรงกับ sql/objects.sql — มีเทสที่เทียบให้ (test/rls.spec.ts)
//     ตารางใหม่ที่มี workspace_id แล้วลืมใส่ที่นี่ = ตารางที่ไม่มี tenant isolation
// ═══════════════════════════════════════════════════════════════════════════
export const TENANT_TABLES = [
  'workspaces',
  'workspace_members',
  'pages',
  'page_acls',
  'page_doc_updates',
  'page_doc_snapshots',
  'page_searches',
  'page_links',
  'page_notes',
  'activity_logs',
] as const;

export const schema = {
  users,
  workspaces,
  workspaceMembers,
  refreshTokens,
  apiTokens,
  pages,
  pageAcls,
  pageDocUpdates,
  pageDocSnapshots,
  pageSearches,
  pageLinks,
  pageNotes,
  activityLogs,
};
