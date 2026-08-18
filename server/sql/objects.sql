-- ═══════════════════════════════════════════════════════════════════════════
--  SQL objects — ทุกอย่างที่ Drizzle เขียนไม่ได้ อยู่ในไฟล์นี้ไฟล์เดียว
--
--  ของเดิมฝั่ง .NET กระจายอยู่ใน Data/Migrations/Sql/001…007 ซึ่งมีปัญหาที่
--  ไฟล์ 001 เตือนไว้เอง: migration ที่ apply แล้วห้ามแก้ย้อนหลัง ของใหม่ต้องไป
--  อยู่ไฟล์เลขสูงกว่า ผลคือ **ต้องไล่อ่านทั้ง 7 ไฟล์ถึงจะรู้ว่าฐานเป็นยังไงตอนนี้**
--  (เช่น ck_page_acls_subject_type ถูกสร้างใน 001 แล้ว DROP+ADD ใหม่ใน 004)
--
--  ไฟล์นี้ต่างออกไป: แต่ละ constraint ปรากฏ **ครั้งเดียวในรูปสุดท้าย** และ
--  ทั้งไฟล์ idempotent — รันซ้ำได้เสมอ จึงไม่ต้องมีประวัติให้ไล่
--
--  ⚠️ รันหลัง drizzle migrate เสมอ (ตารางต้องมีอยู่ก่อน) — ดู scripts/db-setup.ts
--  ⚠️ ต้องรันด้วยบัญชี owner/superuser ไม่ใช่บัญชี pm_app ที่ runtime ใช้
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ ไม่มี psql meta-command (\set, \i) ในไฟล์นี้โดยเจตนา — มันถูกรันผ่าน
--    node-postgres ใน scripts/db-setup.ts ซึ่งส่งทั้งไฟล์เป็น query เดียว
--    ผลพลอยได้คือทั้งไฟล์อยู่ใน implicit transaction: พังกลางทาง = ไม่มีอะไรค้าง

-- ═══════════════════════════════════════════════════════════════════════════
--  0. sanity — extension ที่ขาดไม่ได้
--
--  db/init/001_extensions.sql รันครั้งเดียวตอน container เกิดใหม่เท่านั้น
--  ถ้าใครต่อฐานที่มีอยู่แล้ว extension อาจไม่ครบ — ให้พังตรงนี้ ไม่ใช่พังตอน
--  CREATE INDEX ด้วย error ที่อ่านไม่รู้เรื่อง
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(e, ', ')
      INTO missing
      FROM unnest(ARRAY['pgroonga', 'pgcrypto', 'citext']) AS e
     WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = e);

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'extension ที่ต้องมีหายไป: % — รัน db/init/001_extensions.sql หรือ docker compose down -v', missing;
    END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  1. ตัวอ่าน tenant context
--
--  RLS policy ทุกข้อเรียกฟังก์ชันสองตัวนี้ ไม่ได้เรียก current_setting() ตรง ๆ
--  เพื่อให้การจัดการ "ค่ายังไม่ถูกตั้ง" อยู่ที่เดียว
--
--  ⚠️ NULLIF(…, '') ไม่ใช่ของประดับ: current_setting(name, true) คืน NULL เมื่อ
--     GUC ไม่เคยถูกตั้งใน session นี้ แต่คืน '' (สตริงว่าง) เมื่อเคยตั้งแล้ว
--     หลุดขอบ transaction ไป ซึ่งเป็นสถานะปกติของ connection ที่ถูก reuse
--     จาก pool — และ ''::uuid โยน error ไม่ได้คืน NULL
--
--  ⚠️ ค่า NULL ทำให้ทุก policy เป็นเท็จ = ไม่เห็นแถวไหนเลย ซึ่งเป็นค่าเริ่มต้น
--     ที่ถูกต้อง (fail closed) request ที่ลืมตั้ง tenant จะ "เห็นว่าง" ไม่ใช่
--     "เห็นของคนอื่น"
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION app_current_workspace() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$ SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

COMMENT ON FUNCTION app_current_workspace() IS
    'tenant ปัจจุบัน มาจาก SET LOCAL app.workspace_id — NULL = ยังไม่ได้ตั้ง = ไม่เห็นอะไรเลย';
COMMENT ON FUNCTION app_current_user_id() IS
    'ผู้ใช้ที่ล็อกอินอยู่ มาจาก SET LOCAL app.user_id — ใช้เฉพาะ policy ของ workspaces/workspace_members';


-- ═══════════════════════════════════════════════════════════════════════════
--  2. COLLATE "C" บน pages.rank
--
--  ⚠️ fractional index ใช้ base62 (0-9 A-Z a-z) และอัลกอริทึมทั้งหมดตั้งอยู่บน
--     สมมติฐานว่าการเทียบสตริงเป็น "ordinal"
--
--     แต่ฐานนี้ตั้ง ICU th-TH เป็น collation หลัก ซึ่งเรียงแบบ
--         a0  A0  b0  B0  z0  Z0
--     ขณะที่ byte order เรียงแบบ
--         A0  B0  Z0  a0  b0  z0
--
--     ถ้าไม่บังคับตรงนี้ ORDER BY rank จะให้ลำดับที่ไม่ตรงกับที่ generateKeyBetween
--     คำนวณไว้ → หน้าเรียงสลับกันเอง และการแทรกครั้งถัดไปจะคำนวณจากคู่ที่ผิด
--     อาการโผล่ก็ต่อเมื่อมี rank ที่ปนตัวพิมพ์ใหญ่พิมพ์เล็ก ซึ่งเกิดหลังแทรก/ลบ
--     ไปสักพัก — คือหลัง deploy
--
--  ALTER COLUMN TYPE เขียนตารางใหม่ทั้งใบ จึงเช็คก่อนว่าจำเป็นจริงไหม
--  (ไฟล์นี้ถูกรันซ้ำทุกครั้งที่ setup)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_collation co ON co.oid = a.attcollation
         WHERE c.relname = 'pages'
           AND a.attname = 'rank'
           AND co.collname = 'C'
    ) THEN
        ALTER TABLE pages ALTER COLUMN rank TYPE varchar(200) COLLATE "C";
        RAISE NOTICE 'ตั้ง COLLATE "C" ให้ pages.rank แล้ว';
    END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  3. CHECK constraints
--
--  ค่า enum ถูกเก็บเป็น text (อ่าน SQL ดิบแล้วเข้าใจทันที และแทรกค่าใหม่ตรงกลาง
--  แล้วความหมายของข้อมูลเดิมไม่เปลี่ยน) constraint พวกนี้ทำให้ค่าขยะเข้าฐานไม่ได้
--  แม้จะเขียนผ่าน raw SQL หรือ psql มือเปล่า
--
--  ⚠️ ค่าต้องตรงกับ enum ฝั่ง TypeScript เป๊ะ ๆ — เพิ่มค่าใหม่ = แก้สองที่ในคอมมิตเดียว
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── workspaces ───────────────────────────────────────────────────────────
-- slug ใช้ใน URL — lowercase / เลข / ขีดกลาง ยาว 3–60
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS ck_workspaces_slug_format;
ALTER TABLE workspaces
    ADD CONSTRAINT ck_workspaces_slug_format
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$');

-- ─── users ────────────────────────────────────────────────────────────────
-- แยก "บัญชีของคน" ออกจาก "บัญชีที่ AI ใช้" เพื่อให้ตอบได้ว่าหน้านี้ AI แก้หรือ
-- เจ้าของแก้ — คำถามที่ตอบไม่ได้เลยเมื่อ MCP ใช้บัญชีเดียวกับเจ้าของ
-- ⚠️ ไม่ใช่ระดับสิทธิ์ — agent ได้สิทธิ์จาก workspace_members เหมือนคนทุกอย่าง
ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_kind;
ALTER TABLE users
    ADD CONSTRAINT ck_users_kind
    CHECK (kind IN ('human', 'agent'));

-- ─── workspace_members ────────────────────────────────────────────────────
ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS ck_workspace_members_role;
ALTER TABLE workspace_members
    ADD CONSTRAINT ck_workspace_members_role
    CHECK (role IN ('owner', 'admin', 'member', 'guest'));

-- ─── pages ────────────────────────────────────────────────────────────────
ALTER TABLE pages DROP CONSTRAINT IF EXISTS ck_pages_kind;
ALTER TABLE pages
    ADD CONSTRAINT ck_pages_kind
    CHECK (kind IN ('page', 'database', 'db_row'));

-- database_id ต้องไม่ null เมื่อ kind = db_row และต้อง null เมื่อไม่ใช่
ALTER TABLE pages DROP CONSTRAINT IF EXISTS ck_pages_db_row_has_database;
ALTER TABLE pages
    ADD CONSTRAINT ck_pages_db_row_has_database
    CHECK ((kind = 'db_row') = (database_id IS NOT NULL));

-- depth ต้องเท่ากับความยาวของ ancestor_ids เสมอ
-- ถ้า constraint นี้ fail แปลว่า PageTreeService มีบั๊ก — อยากรู้ทันทีตอนเขียน
-- ไม่ใช่ตอนที่ breadcrumb แสดงผลผิดในอีกสามเดือน
ALTER TABLE pages DROP CONSTRAINT IF EXISTS ck_pages_depth_matches_ancestors;
ALTER TABLE pages
    ADD CONSTRAINT ck_pages_depth_matches_ancestors
    CHECK (depth = cardinality(ancestor_ids));

-- หน้าต้องไม่เป็น ancestor ของตัวเอง
ALTER TABLE pages DROP CONSTRAINT IF EXISTS ck_pages_no_self_ancestor;
ALTER TABLE pages
    ADD CONSTRAINT ck_pages_no_self_ancestor
    CHECK (NOT (id = ANY(ancestor_ids)));

-- NULL คือค่าที่ถูกต้องและพบบ่อยที่สุด — แปลว่า "หน้านี้ไม่ใช่งาน"
ALTER TABLE pages DROP CONSTRAINT IF EXISTS ck_pages_status;
ALTER TABLE pages
    ADD CONSTRAINT ck_pages_status
    CHECK (status IS NULL OR status IN ('todo', 'doing', 'done'));

-- ─── page_acls ────────────────────────────────────────────────────────────
-- ⚠️ ไม่มี 'group' โดยเจตนา — ของเดิมยอมรับค่านั้นทั้งที่ไม่มีตาราง
--    groups/group_members อยู่เลย constraint ที่อนุญาตสถานะซึ่งผลิตไม่ได้
--    คือ constraint ที่หลอกคนอ่านโค้ดให้เชื่อว่าฟีเจอร์นั้นมีอยู่
--
--    ตอนทำ group จริงต้องเพิ่มสามอย่างพร้อมกัน: ตาราง groups + group_members,
--    ค่า 'group' ที่นี่, และ enum ฝั่ง TypeScript (การ resolve สิทธิ์จะกลายเป็น
--    multi-row + หา role สูงสุดในหน่วยความจำ ไม่ใช่ LIMIT 1 แบบตอนนี้)
ALTER TABLE page_acls DROP CONSTRAINT IF EXISTS ck_page_acls_subject_type;
ALTER TABLE page_acls
    ADD CONSTRAINT ck_page_acls_subject_type
    CHECK (subject_type IN ('user', 'workspace'));

ALTER TABLE page_acls DROP CONSTRAINT IF EXISTS ck_page_acls_role;
ALTER TABLE page_acls
    ADD CONSTRAINT ck_page_acls_role
    CHECK (role IN ('full', 'editor', 'commenter', 'viewer'));

-- subject_id ต้องเป็น uuid ว่างเมื่อเป็น grant ระดับ workspace และต้องไม่ว่าง
-- เมื่อเป็น user (คอลัมน์อยู่ใน PK จึง NULL ไม่ได้)
ALTER TABLE page_acls DROP CONSTRAINT IF EXISTS ck_page_acls_subject_id;
ALTER TABLE page_acls
    ADD CONSTRAINT ck_page_acls_subject_id
    CHECK (
        (subject_type =  'workspace' AND subject_id =  '00000000-0000-0000-0000-000000000000')
        OR
        (subject_type <> 'workspace' AND subject_id <> '00000000-0000-0000-0000-000000000000')
    );

-- ─── page_links ───────────────────────────────────────────────────────────
-- ห้ามลิงก์ตัวเอง — mention ที่ชี้กลับมาหน้าเดิมทำให้แผง backlinks โชว์ตัวเอง
ALTER TABLE page_links DROP CONSTRAINT IF EXISTS ck_page_links_no_self;
ALTER TABLE page_links
    ADD CONSTRAINT ck_page_links_no_self
    CHECK (source_page_id <> target_page_id);

-- ─── Yjs ──────────────────────────────────────────────────────────────────
-- snapshot ที่ขนาด 0 ไบต์คือ snapshot ที่ข้อมูลหาย — กันไว้ที่ระดับฐานข้อมูล
ALTER TABLE page_doc_snapshots DROP CONSTRAINT IF EXISTS ck_page_doc_snapshots_byte_size;
ALTER TABLE page_doc_snapshots
    ADD CONSTRAINT ck_page_doc_snapshots_byte_size
    CHECK (byte_size > 0 AND octet_length(snapshot) = byte_size);

ALTER TABLE page_doc_updates DROP CONSTRAINT IF EXISTS ck_page_doc_updates_not_empty;
ALTER TABLE page_doc_updates
    ADD CONSTRAINT ck_page_doc_updates_not_empty
    CHECK (octet_length(update_data) > 0);

-- ─────────────────────────────────────────────────────────────────────────
--  ⚠️ ห้ามใส่ CHECK บน activity_logs.action โดยเจตนา
--
--  log คือข้อมูลประวัติศาสตร์ แถวที่เขียนไปแล้วต้องอ่านได้ตลอดไปแม้โค้ดใหม่
--  เลิกผลิต action นั้น constraint จะทำให้ลบ action เก่าออกจากโค้ดไม่ได้เลย
--  — เป็นข้อยกเว้นเดียวจาก enum อื่นทั้งระบบ
-- ─────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
--  4. FK ของ activity_logs — SET NULL เฉพาะ page_id
--
--  ⚠️ บั๊กที่กันไว้ตรงนี้ร้ายแรงและเงียบจนกว่าจะมีคนกด "ลบถาวร"
--
--  activity_logs อ้าง pages ด้วย composite FK (workspace_id, page_id) เพื่อให้
--  การอ้างข้าม workspace เป็นไปไม่ได้ที่ระดับฐาน (เหมือนตารางลูกอื่นทั้งหมด)
--
--  แต่ ON DELETE SET NULL แบบไม่ระบุคอลัมน์จะเซ็ต "ทุกคอลัมน์ใน FK" เป็น NULL
--  ซึ่งรวม workspace_id ที่เป็น NOT NULL → การ purge หน้าจะล้มด้วย
--  not-null violation แปลว่า "ลบถาวรหน้าที่มีประวัติไม่ได้เลย"
--
--  PostgreSQL 15+ ให้ระบุได้ว่าจะ SET NULL คอลัมน์ไหน — ฐานนี้เป็น 18 จึงใช้ได้
--  Drizzle เขียนรูปแบบนี้เองไม่ได้ (เหมือน EF Core) จึงต้อง DROP แล้ว ADD ใหม่
--
--  ผลที่ต้องการ: purge หน้าแล้วแถวประวัติยังอยู่ โดย page_id กลายเป็น NULL
--  และ workspace_id ยังคงอยู่ → RLS ยังทำงาน และ page_title ที่เก็บสำเนาไว้
--  ทำให้ยังตอบได้ว่า "ใครลบหน้าชื่ออะไร"
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE activity_logs DROP CONSTRAINT IF EXISTS fk_activity_logs_pages;
ALTER TABLE activity_logs
    ADD CONSTRAINT fk_activity_logs_pages
    FOREIGN KEY (workspace_id, page_id)
    REFERENCES pages (workspace_id, id)
    ON DELETE SET NULL (page_id);


-- ═══════════════════════════════════════════════════════════════════════════
--  5. Index ที่ Drizzle เขียนไม่ได้: partial (WHERE …), GIN, operator class
--
--  index เต็มตารางที่ถูกแทนด้วย partial version ไม่ได้ถูกประกาศใน schema.ts
--  ตั้งแต่ต้น (ไม่ต้อง DROP ทิ้งเหมือนตอนใช้ EF) — index ซ้ำซ้อนกิน write
--  throughput ฟรี ๆ
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── sidebar tree ─────────────────────────────────────────────────────────
--  query หลักคือ "ลูกของหน้านี้ เรียงตาม rank" ซึ่งวิ่งทุกครั้งที่กางโฟลเดอร์
--  partial condition ตัดหน้าที่ถูกลบและตัดแถวของ database ออก (แถว database
--  ไม่โผล่ใน sidebar) ทำให้ index เล็กลงมากในระบบที่มี database เยอะ
CREATE INDEX IF NOT EXISTS ix_pages_sidebar
    ON pages (workspace_id, parent_id, rank, id)
 WHERE deleted_at IS NULL AND database_id IS NULL;

-- ─── subtree operations ───────────────────────────────────────────────────
--  GIN บน uuid[] ทำให้ `ancestor_ids @> ARRAY[$id]` เป็น index scan
--  นี่คือ index ที่ทำให้ "ย้ายหน้าที่มีลูกหลาน 500 หน้า" เป็น UPDATE เดียว
--  แทนที่จะเป็น recursive loop
CREATE INDEX IF NOT EXISTS ix_pages_ancestor_ids_gin
    ON pages USING gin (ancestor_ids);

-- ─── database rows ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_pages_database_rows
    ON pages (database_id, rank, id)
 WHERE database_id IS NOT NULL AND deleted_at IS NULL;

-- jsonb_path_ops เล็กและเร็วกว่า jsonb_ops สำหรับ containment (@>) ซึ่งเป็น
-- predicate เดียวที่ filter ของ view ใช้ (แลกกับที่ค้นด้วย key เดี่ยว ? ไม่ได้)
CREATE INDEX IF NOT EXISTS ix_pages_properties_gin
    ON pages USING gin (properties jsonb_path_ops)
 WHERE database_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_pages_computed_gin
    ON pages USING gin (computed jsonb_path_ops)
 WHERE database_id IS NOT NULL AND deleted_at IS NULL;

-- ─── trash ────────────────────────────────────────────────────────────────
-- "หน้าที่ถูกลบใน workspace นี้" ต้องไม่ scan ทั้งตาราง
CREATE INDEX IF NOT EXISTS ix_pages_trash
    ON pages (workspace_id, deleted_at DESC)
 WHERE deleted_at IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
--  6. PGroonga — full-text search ที่ใช้งานได้กับภาษาไทย
--
--  ⚠️⚠️ WITH (tokenizer = …) ไม่ใช่ของเสริม มันคือสิ่งที่ทำให้ทำงานได้
--
--  ค่า default ของ PGroonga ตัดคำด้วย "ช่องว่าง" แล้วทำ prefix match
--  ภาษาไทยไม่มีช่องว่างระหว่างคำ ทั้งประโยคจึงกลายเป็น token เดียว และค้นเจอ
--  เฉพาะคำที่เป็น prefix ของก้อนนั้นเท่านั้น
--
--  ผลทดสอบจริง (groonga/pgroonga 4.0.6 / PostgreSQL 18.3):
--
--      query        default         + bigram tokenizer
--      ─────────────────────────────────────────────────
--      ข้าวผัด       0 แถว  ✗        เจอ  ✓
--      กระเพรา      0 แถว  ✗        เจอ  ✓
--      ไก่           0 แถว  ✗        เจอ  ✓
--      ยอดขาย       เจอ    ✓        เจอ  ✓   ← เจอเพราะเป็น prefix
--
--  บรรทัด 'ยอดขาย' คือกับดัก: ถ้า test corpus ใช้คำต้นประโยคหมด จะผ่านเทส
--  ทั้งที่ค้นหาพัง — รัน db/probe/thai-search-probe.sql เพื่อตรวจซ้ำ
--
--  ⚠️ เปลี่ยน tokenizer ทีหลังต้อง REINDEX ทั้งตาราง จึงต้องตั้งให้ถูกตั้งแต่ต้น
-- ═══════════════════════════════════════════════════════════════════════════

-- bigram: ตัดข้อความที่ไม่ใช่ ASCII เป็นคู่อักขระซ้อนกัน ทำให้ค้นคำที่อยู่
-- ตรงกลางประโยคได้ · unify_alphabet=false เก็บความต่างของตัวพิมพ์ในสคริปต์ละติน
CREATE INDEX IF NOT EXISTS ix_page_searches_body_pgrn
    ON page_searches
 USING pgroonga (search_text)
  WITH (tokenizer = 'TokenNgram("n", 2, "unify_alphabet", false)');

-- index แยกบน title เพื่อ boost คะแนนเมื่อคำค้นตรงกับชื่อหน้า
CREATE INDEX IF NOT EXISTS ix_page_searches_title_pgrn
    ON page_searches
 USING pgroonga (title)
  WITH (tokenizer = 'TokenNgram("n", 2, "unify_alphabet", false)');


-- ═══════════════════════════════════════════════════════════════════════════
--  7. Row Level Security — จุดที่ tenant isolation ถูกบังคับใช้ หรือหลุด
--
--  ของเดิมฝั่ง .NET ใช้ global query filter ของ EF ซึ่งอยู่ในโค้ด Drizzle ไม่มี
--  อะไรเทียบเท่าเลย การบังคับจึงย้ายลงมาที่ Postgres ซึ่ง **แข็งแรงกว่าเดิม**:
--  raw SQL, psql มือเปล่า และ query ที่ลืมใส่ WHERE ก็ถูกกรองเหมือนกันหมด
--
--  ⚠️ กับดักที่ 1 — connection pool
--     ค่าถูกส่งผ่าน GUC ซึ่งผูกกับ "session" ไม่ใช่ "request" ถ้าตั้งด้วย SET
--     ธรรมดา (ไม่ใช่ SET LOCAL) ค่าจะติดค้างไปกับ connection แล้ว request ถัดไป
--     ที่หยิบ connection เดิมได้ tenant ผิด — เป็น tenant leak ที่เทสปกติจับไม่เจอ
--     เพราะต้อง reuse connection ถึงจะโผล่
--     → ฝั่ง Node ใช้ set_config(…, true) ใน transaction เท่านั้น (db.service.ts)
--     → test/rls.spec.ts มีเทสที่บังคับ pool ให้เหลือ connection เดียวโดยเฉพาะ
--
--  ⚠️ กับดักที่ 2 — RLS ไม่มีผลกับ superuser และ (ถ้าไม่ FORCE) ไม่มีผลกับ owner
--     ถ้า runtime ต่อด้วย postgres ทุก policy ที่เขียนไว้จะถูกข้ามทั้งหมดและ
--     **ดูเหมือนผ่านหมด** จึงต้องต่อด้วย pm_app ที่เป็น NOSUPERUSER NOBYPASSRLS
--     → test/rls.spec.ts ตรวจคุณสมบัติของ role โดยตรง ไม่ได้เชื่อว่าตั้งถูก
--
--  ⚠️ policy ไม่ระบุ role (= PUBLIC) โดยเจตนา — บวกกับ FORCE ทำให้ **ไม่มีใคร**
--     นอกจาก superuser ที่หลุดได้ ถ้าวันหนึ่งเปลี่ยน owner เป็น non-superuser
--     policy ก็ยังบังคับกับ owner ด้วย
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
--  ตารางที่ผูกกับ workspace ตรง ๆ — policy เดียวกันหมด
--
--  ⚠️ รายการนี้ต้องตรงกับ TENANT_TABLES ใน src/db/schema.ts (มีเทสเทียบให้)
--     ตารางใหม่ที่มี workspace_id แล้วลืมเติมที่นี่ = ตารางที่ไม่มี isolation
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'pages',
        'page_acls',
        'page_doc_updates',
        'page_doc_snapshots',
        'page_searches',
        'page_links',
        'page_notes',
        'activity_logs'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format($f$
            CREATE POLICY tenant_isolation ON %I
                FOR ALL
                USING      (workspace_id = app_current_workspace())
                WITH CHECK (workspace_id = app_current_workspace())
        $f$, t);
    END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
--  workspace_members — ต้องอ่านได้ตอนที่ยังไม่รู้ว่า workspace ไหน
--
--  หน้าจอ "เลือก workspace" หลังล็อกอินอ่านตารางนี้ก่อนที่จะมี tenant
--  ถ้า policy มีแต่ workspace_id = app_current_workspace() รายการจะว่างเสมอ
--  และผู้ใช้จะเข้าระบบไม่ได้เลย
--
--  ทางออกคือให้ policy ยอมรับ "แถวของฉันเอง" เพิ่มอีกทางหนึ่ง — ซึ่งไม่ได้
--  ทำให้หลวมลง เพราะแถวของฉันคือสิ่งที่ฉันมีสิทธิ์เห็นอยู่แล้วโดยนิยาม
--
--  ⚠️ ฝั่งเขียนไม่ผ่อน: เพิ่ม/ลบ/แก้สมาชิกต้องมี tenant เสมอ ไม่งั้นใครก็
--     เติมตัวเองเข้า workspace ใครก็ได้
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation      ON workspace_members;
DROP POLICY IF EXISTS members_select_own    ON workspace_members;
DROP POLICY IF EXISTS members_write_tenant  ON workspace_members;

CREATE POLICY members_select_own ON workspace_members
    FOR SELECT
    USING (workspace_id = app_current_workspace() OR user_id = app_current_user_id());

CREATE POLICY members_write_tenant ON workspace_members
    FOR ALL
    USING      (workspace_id = app_current_workspace())
    WITH CHECK (workspace_id = app_current_workspace());

-- ─────────────────────────────────────────────────────────────────────────
--  workspaces — ตารางนี้ "คือ" tenant จึงกรองด้วย id ไม่ใช่ workspace_id
--
--  สามทางที่ต้องเปิด และเหตุผลของแต่ละทาง:
--
--    1. อ่าน workspace ที่กำลังใช้อยู่          id = app_current_workspace()
--    2. อ่านรายการ "workspace ของฉัน"          ผ่าน workspace_members
--       (ทางเดียวกับที่ IdentityQueries ของเดิมข้าม tenant filter โดยเจตนา)
--    3. สร้าง workspace ใหม่                    created_by = ฉัน
--       ⚠️ ตอน INSERT ยังไม่มี tenant ให้ตั้ง (id เพิ่งเกิด) และยังไม่มีแถว
--          ใน workspace_members ด้วย จึงต้องยอมรับด้วยเงื่อนไข created_by
--          ขั้นตอนถัดไปในธุรกรรมเดียวกันคือ enterWorkspace(id) แล้วค่อยเขียน
--          สมาชิก/หน้าแรก — ดู DbService.withIdentity ใน src/db/db.service.ts
--
--  ⚠️ policy ของ SELECT อ้าง workspace_members ซึ่งมี RLS ของตัวเอง subquery
--     จึงถูกกรองด้วย members_select_own อีกชั้น (user_id = ฉัน) — ตั้งใจให้เป็น
--     แบบนั้น ไม่ใช่ช่องโหว่: ฉันเห็น workspace ที่ฉันเป็นสมาชิกเท่านั้น
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation    ON workspaces;
DROP POLICY IF EXISTS workspaces_select   ON workspaces;
DROP POLICY IF EXISTS workspaces_insert   ON workspaces;
DROP POLICY IF EXISTS workspaces_update   ON workspaces;
DROP POLICY IF EXISTS workspaces_delete   ON workspaces;

CREATE POLICY workspaces_select ON workspaces
    FOR SELECT
    USING (
        id = app_current_workspace()
        OR id IN (SELECT m.workspace_id
                    FROM workspace_members m
                   WHERE m.user_id = app_current_user_id())
    );

CREATE POLICY workspaces_insert ON workspaces
    FOR INSERT
    WITH CHECK (created_by = app_current_user_id());

CREATE POLICY workspaces_update ON workspaces
    FOR UPDATE
    USING      (id = app_current_workspace())
    WITH CHECK (id = app_current_workspace());

CREATE POLICY workspaces_delete ON workspaces
    FOR DELETE
    USING (id = app_current_workspace());

-- ─────────────────────────────────────────────────────────────────────────
--  ตารางที่ "ไม่มี" RLS โดยเจตนา — ทั้งสามข้อเป็นการตัดสินใจ ไม่ใช่การลืม
--
--    users, refresh_tokens
--      ข้อมูลระดับ identity ไม่ผูก workspace เข้าถึงด้วย predicate ที่ระบุ
--      user ชัดเจนเสมอ (login, refresh, /me) การใส่ policy ที่อิง
--      app_current_workspace() จะทำให้ล็อกอินไม่ได้เลยเพราะยังไม่มี tenant
--
--    api_tokens
--      การ resolve token เกิด "ก่อน" ที่ระบบจะรู้ว่า request นี้อยู่ workspace
--      ไหน — workspace มาจากตัว token เอง ถ้าใส่ policy การ lookup จะไม่เจอ
--      อะไรเลย ขอบเขตถูกจำกัดด้วย workspace_id ที่ผูกกับใบ ตรวจในโค้ด
-- ─────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
--  8. สิทธิ์ของ pm_app — บัญชีที่ runtime ใช้
--
--  role ถูกสร้าง (พร้อมรหัสผ่านจาก env) ใน scripts/db-setup.ts ไม่ใช่ที่นี่
--  ไฟล์นี้ commit ลง git จึงไม่มีรหัสผ่านอยู่ในนั้นได้
--
--  ⚠️ ห้ามให้ pm_app เป็นเจ้าของตารางใด ๆ และห้าม BYPASSRLS — ทั้งสองอย่าง
--     ทำให้ policy ข้างบนกลายเป็นของประดับ
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pm_app') THEN
        RAISE EXCEPTION 'ยังไม่มี role pm_app — รัน npm run db:setup ซึ่งสร้างให้ก่อนเรียกไฟล์นี้';
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO pm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO pm_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO pm_app;
GRANT EXECUTE                        ON FUNCTION app_current_workspace(), app_current_user_id() TO pm_app;

-- ตารางที่ migration ในอนาคตสร้างขึ้นต้องได้สิทธิ์เหมือนกันโดยไม่ต้องมาแก้ที่นี่
-- ⚠️ ผูกกับ "ผู้สร้าง" ไม่ใช่ schema — ต้องเป็น role เดียวกับที่รัน migration
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO pm_app;

-- drizzle เก็บประวัติ migration ไว้ใน schema แยก — runtime ไม่ต้องอ่านเลย
-- (เป็น defense in depth: schema ที่ไม่ใช่ public ไม่ให้สิทธิ์ PUBLIC อยู่แล้ว)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
        REVOKE ALL ON SCHEMA drizzle FROM pm_app;
    END IF;
END $$;
