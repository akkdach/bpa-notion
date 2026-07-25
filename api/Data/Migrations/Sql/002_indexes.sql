-- ═══════════════════════════════════════════════════════════════════════════
--  Index ที่ EF Core เขียนไม่ได้: partial (WHERE …), GIN, operator class
--
--  index ที่ EF สร้างมาแบบเต็มตารางจะถูก DROP แล้วแทนด้วย partial version
--  ที่แคบกว่า — index ซ้ำซ้อนกินค่า write throughput ฟรี ๆ
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
--  sidebar tree
--
--  query หลักคือ "ลูกของหน้านี้ เรียงตาม rank" ซึ่งวิ่งทุกครั้งที่กางโฟลเดอร์
--  partial condition ตัดหน้าที่ถูกลบและตัดแถวของ database ออก (แถว database
--  ไม่โผล่ใน sidebar) ทำให้ index เล็กลงมากในระบบที่มี database เยอะ
-- ─────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS ix_pages_workspace_id_parent_id_rank;

CREATE INDEX ix_pages_sidebar
    ON pages (workspace_id, parent_id, rank, id)
 WHERE deleted_at IS NULL AND database_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
--  subtree operations
--
--  GIN บน uuid[] ทำให้ `ancestor_ids @> ARRAY[$id]` เป็น index scan
--  นี่คือ index ที่ทำให้ "ย้ายหน้าที่มีลูกหลาน 500 หน้า" เป็น UPDATE เดียว
--  แทนที่จะเป็น recursive loop
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX ix_pages_ancestor_ids_gin
    ON pages USING gin (ancestor_ids);

-- ─────────────────────────────────────────────────────────────────────────
--  database rows (Phase 4)
-- ─────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS ix_pages_database_id_rank;

CREATE INDEX ix_pages_database_rows
    ON pages (database_id, rank, id)
 WHERE database_id IS NOT NULL AND deleted_at IS NULL;

-- jsonb_path_ops เล็กและเร็วกว่า jsonb_ops สำหรับ containment (@>) ซึ่งเป็น
-- predicate เดียวที่ filter ของ view ใช้ (แลกกับที่ค้นด้วย key เดี่ยว ? ไม่ได้)
CREATE INDEX ix_pages_properties_gin
    ON pages USING gin (properties jsonb_path_ops)
 WHERE database_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX ix_pages_computed_gin
    ON pages USING gin (computed jsonb_path_ops)
 WHERE database_id IS NOT NULL AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
--  trash — query "หน้าที่ถูกลบใน workspace นี้" ต้องไม่ scan ทั้งตาราง
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX ix_pages_trash
    ON pages (workspace_id, deleted_at DESC)
 WHERE deleted_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
--  Yjs bootstrap — อ่าน update ของหน้าหนึ่งเรียงตาม seq
--  EF สร้าง (page_id, seq) ไว้แล้ว ที่นี่เพิ่มแค่ index สำหรับหา snapshot ล่าสุด
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX ix_page_doc_snapshots_latest
    ON page_doc_snapshots (page_id, up_to_seq DESC);
