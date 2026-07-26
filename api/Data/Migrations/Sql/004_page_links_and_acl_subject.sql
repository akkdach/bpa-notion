-- ═══════════════════════════════════════════════════════════════════════════
--  page_links + บีบ CHECK ของ page_acls
--
--  สองเรื่องนี้อยู่ไฟล์เดียวกันเพราะมาจาก migration เดียวกัน ไม่ได้เกี่ยวกันเอง
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── page_links ───────────────────────────────────────────────────────────
-- ห้ามลิงก์ตัวเอง — mention ที่ชี้กลับมาหน้าเดิมทำให้แผง backlinks โชว์ตัวเอง
ALTER TABLE page_links
    ADD CONSTRAINT ck_page_links_no_self
    CHECK (source_page_id <> target_page_id);

-- ─────────────────────────────────────────────────────────────────────────
--  บีบ subject_type ให้เหลือค่าที่ระบบสร้างได้จริง
--
--  ของเดิมยอมรับ 'group' ด้วย ทั้งที่ไม่มีตาราง groups/group_members อยู่เลย
--  ค่านั้นจึงไม่มีทางถูกสร้างขึ้นได้ และ constraint ก็ทำหน้าที่หลอกคนอ่านว่า
--  ฟีเจอร์ group มีอยู่แล้ว
--
--  ตอนทำ group จริง ให้กลับมาแก้ที่นี่ พร้อมกับ AclSubjectType ใน Domain/Roles.cs
--  และตาราง groups + group_members
--
--  DROP ก่อน ADD เพราะ constraint เดิมสร้างไว้ใน 001_check_constraints.sql
--  (migration ก่อนหน้าไม่ถูกรันซ้ำ จึงต้องแก้ที่นี่ ไม่ใช่ไปแก้ไฟล์นั้น —
--   ไฟล์ SQL ของ migration ที่ apply ไปแล้วถือเป็นประวัติศาสตร์ ห้ามแก้ย้อนหลัง)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE page_acls
    DROP CONSTRAINT IF EXISTS ck_page_acls_subject_type;

ALTER TABLE page_acls
    ADD CONSTRAINT ck_page_acls_subject_type
    CHECK (subject_type IN ('user', 'workspace'));
