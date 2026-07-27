-- ═══════════════════════════════════════════════════════════════════════════
--  แก้ FK ของ activity_logs ให้ SET NULL เฉพาะ page_id
--
--  ⚠️ บั๊กที่กันไว้ตรงนี้ร้ายแรงและเงียบจนกว่าจะมีคนกด "ลบถาวร"
--
--  activity_logs อ้าง pages ด้วย composite FK (workspace_id, page_id) เพื่อให้
--  การอ้างข้ามworkspace เป็นไปไม่ได้ที่ระดับฐาน (เหมือนตารางลูกอื่นทั้งหมด)
--
--  แต่ ON DELETE SET NULL แบบไม่ระบุคอลัมน์จะเซ็ต "ทุกคอลัมน์ใน FK" เป็น NULL
--  ซึ่งรวม workspace_id ที่เป็น NOT NULL → การ purge หน้าจะล้มด้วย
--  not-null violation แปลว่า "ลบถาวรหน้าที่มีประวัติไม่ได้เลย"
--
--  PostgreSQL 15+ ให้ระบุได้ว่าจะ SET NULL คอลัมน์ไหน — ฐานนี้เป็น 18 จึงใช้ได้
--  EF Core เขียนรูปแบบนี้เองไม่ได้ (ReferentialAction ไม่มีที่ให้ใส่ column list)
--  จึงต้อง DROP แล้ว ADD ใหม่ด้วย raw SQL
--
--  ผลที่ต้องการ: purge หน้าแล้วแถวประวัติยังอยู่ โดย page_id กลายเป็น NULL
--  และ workspace_id ยังคงอยู่ → tenant filter ยังทำงาน และ page_title ที่เก็บ
--  สำเนาไว้ทำให้ยังตอบได้ว่า "ใครลบหน้าชื่ออะไร"
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE activity_logs
    DROP CONSTRAINT fk_activity_logs_pages_workspace_id_page_id;

ALTER TABLE activity_logs
    ADD CONSTRAINT fk_activity_logs_pages_workspace_id_page_id
    FOREIGN KEY (workspace_id, page_id)
    REFERENCES pages (workspace_id, id)
    ON DELETE SET NULL (page_id);
