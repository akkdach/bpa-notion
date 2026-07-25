-- ═══════════════════════════════════════════════════════════════════════════
--  PGroonga — full-text search ที่ใช้งานได้กับภาษาไทย
--
--  ⚠️⚠️ WITH (tokenizer = …) ไม่ใช่ของเสริม มันคือสิ่งที่ทำให้ทำงานได้
--
--  ค่า default ของ PGroonga ตัดคำด้วย "ช่องว่าง" แล้วทำ prefix match
--  ภาษาไทยไม่มีช่องว่างระหว่างคำ ทั้งประโยคจึงกลายเป็น token เดียว และค้นเจอ
--  เฉพาะคำที่เป็น prefix ของก้อนนั้นเท่านั้น
--
--  ผลทดสอบจริง (Phase 0, groonga/pgroonga 4.0.6 / PostgreSQL 18.3):
--
--      query        default         + bigram tokenizer
--      ─────────────────────────────────────────────────
--      ข้าวผัด       0 แถว  ✗        เจอ  ✓
--      กระเพรา      0 แถว  ✗        เจอ  ✓
--      ไก่           0 แถว  ✗        เจอ  ✓
--      ยอดขาย       เจอ    ✓        เจอ  ✓   ← เจอเพราะเป็น prefix
--
--  บรรทัด 'ยอดขาย' คือกับดัก: ถ้า test corpus ใช้คำต้นประโยคหมด จะผ่านเทส
--  ทั้งที่ค้นหาพัง
--
--  รัน db/probe/thai-search-probe.sql เพื่อตรวจซ้ำ (CI รันให้ทุก push)
--
--  ⚠️ เปลี่ยน tokenizer ทีหลังต้อง REINDEX ทั้งตาราง จึงต้องตั้งให้ถูกตั้งแต่ต้น
-- ═══════════════════════════════════════════════════════════════════════════

-- bigram: ตัดข้อความที่ไม่ใช่ ASCII เป็นคู่อักขระซ้อนกัน ทำให้ค้นคำที่อยู่
-- ตรงกลางประโยคได้ unify_alphabet=false เก็บความต่างของตัวพิมพ์ในสคริปต์ละติน
CREATE INDEX ix_page_searches_body_pgrn
    ON page_searches
 USING pgroonga (search_text)
  WITH (tokenizer = 'TokenNgram("n", 2, "unify_alphabet", false)');

-- index แยกบน title เพื่อ boost คะแนนเมื่อคำค้นตรงกับชื่อหน้า
CREATE INDEX ix_page_searches_title_pgrn
    ON page_searches
 USING pgroonga (title)
  WITH (tokenizer = 'TokenNgram("n", 2, "unify_alphabet", false)');
