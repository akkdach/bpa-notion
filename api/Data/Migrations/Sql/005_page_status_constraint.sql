-- ═══════════════════════════════════════════════════════════════════════════
--  ck_pages_status
--
--  `pages.status` ถูกเพิ่มใน migration AddPageStatus โดยไม่มี CHECK constraint
--  ทำให้เป็นคอลัมน์ enum เดียวในระบบที่ค่าขยะเข้าได้ (ทุกตัวอื่นถูกกันไว้ใน
--  001_check_constraints.sql) ทั้ง raw SQL, psql มือเปล่า และ ExecuteUpdateAsync
--  ที่ข้าม validation ของ service ไปเขียนได้ตรง ๆ
--
--  NULL คือค่าที่ถูกต้องและพบบ่อยที่สุด — แปลว่า "หน้านี้ไม่ใช่งาน"
--
--  ⚠️ ค่าต้องตรงกับ PageStatus.All ใน Domain/PageStatus.cs เป๊ะ ๆ
--     เพิ่มสถานะใหม่ = แก้สองที่ในคอมมิตเดียว
--
--  ⚠️ ถ้าฐานมีแถวที่ status ไม่อยู่ในรายการอยู่ก่อน ALTER TABLE จะพังทั้ง migration
--     จึงล้างให้เป็น NULL ก่อน — ค่าที่ service ไม่เคยยอมให้เขียนคือค่าที่มาจาก
--     ทางอื่นและเชื่อถือไม่ได้อยู่แล้ว
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE pages
   SET status = NULL
 WHERE status IS NOT NULL
   AND status NOT IN ('todo', 'doing', 'done');

ALTER TABLE pages
    ADD CONSTRAINT ck_pages_status
    CHECK (status IS NULL OR status IN ('todo', 'doing', 'done'));
