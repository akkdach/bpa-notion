-- ═══════════════════════════════════════════════════════════════════════════
--  CHECK constraints
--
--  ค่า enum ถูกเก็บเป็น text (ดู Domain/Roles.cs) constraint พวกนี้ทำให้ค่าขยะ
--  เข้าฐานไม่ได้ แม้จะเขียนผ่าน raw SQL หรือ psql มือเปล่า
--
--  ⚠️ ค่าต้องตรงกับ RoleNames ใน Domain/Roles.cs เป๊ะ ๆ ถ้าไม่ตรง
--     RoleConverters จะ throw ตอนอ่านข้อมูล
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE workspace_members
    ADD CONSTRAINT ck_workspace_members_role
    CHECK (role IN ('owner', 'admin', 'member', 'guest'));

ALTER TABLE pages
    ADD CONSTRAINT ck_pages_kind
    CHECK (kind IN ('page', 'database', 'db_row'));

-- database_id ต้องไม่ null เมื่อ kind = db_row และต้อง null เมื่อไม่ใช่
ALTER TABLE pages
    ADD CONSTRAINT ck_pages_db_row_has_database
    CHECK ((kind = 'db_row') = (database_id IS NOT NULL));

-- depth ต้องเท่ากับความยาวของ ancestor_ids เสมอ
-- ถ้า constraint นี้ fail แปลว่า PageTreeService มีบั๊ก — อยากรู้ทันทีตอนเขียน
-- ไม่ใช่ตอนที่ breadcrumb แสดงผลผิดในอีกสามเดือน
ALTER TABLE pages
    ADD CONSTRAINT ck_pages_depth_matches_ancestors
    CHECK (depth = cardinality(ancestor_ids));

-- หน้าต้องไม่เป็น ancestor ของตัวเอง
ALTER TABLE pages
    ADD CONSTRAINT ck_pages_no_self_ancestor
    CHECK (NOT (id = ANY(ancestor_ids)));

ALTER TABLE page_acls
    ADD CONSTRAINT ck_page_acls_subject_type
    CHECK (subject_type IN ('user', 'group', 'workspace'));

ALTER TABLE page_acls
    ADD CONSTRAINT ck_page_acls_role
    CHECK (role IN ('full', 'editor', 'commenter', 'viewer'));

-- subject_id ต้องเป็น uuid ว่างเมื่อเป็น grant ระดับ workspace และต้องไม่ว่าง
-- เมื่อเป็น user/group (คอลัมน์อยู่ใน PK จึง NULL ไม่ได้ ดู PageAcl.SubjectId)
ALTER TABLE page_acls
    ADD CONSTRAINT ck_page_acls_subject_id
    CHECK (
        (subject_type = 'workspace' AND subject_id = '00000000-0000-0000-0000-000000000000')
        OR
        (subject_type <> 'workspace' AND subject_id <> '00000000-0000-0000-0000-000000000000')
    );

-- snapshot ที่ขนาด 0 ไบต์คือ snapshot ที่ข้อมูลหาย — กันไว้ที่ระดับฐานข้อมูล
ALTER TABLE page_doc_snapshots
    ADD CONSTRAINT ck_page_doc_snapshots_byte_size
    CHECK (byte_size > 0 AND octet_length(snapshot) = byte_size);

ALTER TABLE page_doc_updates
    ADD CONSTRAINT ck_page_doc_updates_not_empty
    CHECK (octet_length(update_data) > 0);

-- slug ใช้ใน URL — จำกัดให้เป็น lowercase / เลข / ขีดกลาง
ALTER TABLE workspaces
    ADD CONSTRAINT ck_workspaces_slug_format
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$');
