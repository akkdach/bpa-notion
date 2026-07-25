-- ═══════════════════════════════════════════════════════════════════════════
--  Thai full-text search probe
--
--  รัน:
--    docker compose exec -T postgres \
--      psql -U postgres -d projectmanagement -v ON_ERROR_STOP=1 \
--      < db/probe/thai-search-probe.sql
--
--  ทำไมต้องมีไฟล์นี้ค้างไว้ใน repo:
--
--  PGroonga "ทำงาน" กับภาษาไทยเฉพาะเมื่อระบุ tokenizer เท่านั้น ค่า default
--  ตัดคำด้วยช่องว่างแล้วทำ prefix match — ภาษาไทยไม่มีช่องว่างระหว่างคำ ทั้ง
--  ประโยคจึงกลายเป็น token เดียว และค้นเจอเฉพาะคำที่เป็น "prefix" ของก้อนนั้น
--
--  กับดักคือมันดูเหมือนทำงาน: 'ยอดขาย' เจอเพราะเป็น prefix ของ
--  'ยอดขายเครื่องดื่ม…' ถ้า test corpus ใช้คำต้นประโยคหมด จะผ่านเทสทั้งที่พัง
--
--  ผลรอบแรก (Phase 0, groonga/pgroonga:4.0.6-debian-18):
--    default tokenizer  → ข้าวผัด / กระเพรา / ไก่ ได้ 0 แถวทั้งสามคำ
--    bigram tokenizer   → ถูกต้องทุกคำ, ไม่ over-match, ใช้ Index Scan
--
--  ⚠️ เปลี่ยน tokenizer ทีหลังต้อง REINDEX ทั้งตาราง
--
--  Phase 6: เปลี่ยน corpus เป็นข้อมูลจริง ~2,000 หน้า แล้ววัด recall กับ
--  ขนาด index ซ้ำ — ความถูกต้องบน corpus เล็กพิสูจน์แล้ว ที่ volume ยังไม่
-- ═══════════════════════════════════════════════════════════════════════════

\set QUIET on
DROP TABLE IF EXISTS thai_search_probe;

CREATE TABLE thai_search_probe (
    id          int PRIMARY KEY,
    title       text NOT NULL,
    body        text NOT NULL,
    search_text text GENERATED ALWAYS AS (title || ' ' || body) STORED
);

-- ต้องมี WITH (tokenizer = …) — นี่คือประเด็นทั้งหมดของไฟล์นี้
CREATE INDEX thai_search_probe_pgrn ON thai_search_probe
    USING pgroonga (search_text)
    WITH (tokenizer = 'TokenNgram("n", 2, "unify_alphabet", false)');

INSERT INTO thai_search_probe (id, title, body) VALUES
 (1, 'สูตรข้าวผัดกระเพราไก่',  'ผัดกระเพราไก่สับ ใส่พริกกับกระเทียม อร่อยมาก'),
 (2, 'รายงานยอดขายไตรมาส 2',  'ยอดขายเครื่องดื่มเพิ่มขึ้น 15% จากไตรมาสก่อน'),
 (3, 'Chicken rice recipe',   'ข้าวมันไก่ สูตรต้นตำรับ กับน้ำจิ้มเต้าเจี้ยว'),
 (4, 'ประชุมทีมพัฒนา',         'สรุปงาน sprint 12 และแผนงาน sprint 13 ของทีม backend'),
 (5, 'ผัดไทยกุ้งสด',            'เส้นจันท์ผัดกับซอสมะขาม ใส่กุ้งสดและถั่วงอก');
\set QUIET off

-- ═══ ตารางผล: expected vs actual ═══
WITH cases(q, expected) AS (VALUES
    ('ข้าวผัด',      ARRAY[1]),        -- กลางประโยค — เคสที่ default tokenizer พัง
    ('กระเพรา',      ARRAY[1]),
    ('ไก่',          ARRAY[1, 3]),
    ('ผัด',          ARRAY[1, 5]),     -- คำสั้น
    ('ยอดขาย',       ARRAY[2]),        -- prefix — ผ่านแม้ tokenizer ผิด (กับดัก)
    ('chicken',      ARRAY[3]),        -- อังกฤษ
    ('sprint',       ARRAY[4]),
    ('กระเพรา ไก่',  ARRAY[1]),        -- หลายคำ = AND
    ('รถยนต์',       ARRAY[]::int[]),  -- over-match probe: ต้องไม่เจอ
    ('ยอดขายรถยนต์', ARRAY[]::int[])
)
SELECT c.q AS query,
       c.expected,
       COALESCE(
         (SELECT array_agg(p.id ORDER BY p.id)
            FROM thai_search_probe p
           WHERE p.search_text &@~ c.q),
         ARRAY[]::int[]
       ) AS actual,
       CASE WHEN COALESCE(
              (SELECT array_agg(p.id ORDER BY p.id)
                 FROM thai_search_probe p WHERE p.search_text &@~ c.q),
              ARRAY[]::int[]
            ) = c.expected
            THEN 'PASS' ELSE 'FAIL' END AS result
FROM cases c;

-- ═══ relevance score + snippet ต้องทำงานกับภาษาไทย ═══
SELECT id,
       pgroonga_score(tableoid, ctid)::numeric(10,2) AS score,
       (pgroonga_snippet_html(body, pgroonga_query_extract_keywords('ผัดกระเพรา')))[1] AS snippet
  FROM thai_search_probe
 WHERE search_text &@~ 'ผัดกระเพรา'
 ORDER BY score DESC;

-- ═══ ต้องเป็น Index Scan ไม่ใช่ Seq Scan + Filter ═══
EXPLAIN (COSTS OFF)
SELECT id FROM thai_search_probe WHERE search_text &@~ 'ข้าวผัด';

-- ═══ เรียงคำไทย: ICU ต้องต่างจาก byte order ═══
-- ICU:  กระเพรา · เก้าอี้ · ไก่ · ข้าวผัด · โต๊ะ   (สระนำเรียงใต้พยัญชนะ — ถูก)
-- C:    กระเพรา · ข้าวผัด · เก้าอี้ · โต๊ะ · ไก่    (byte order — ผิด)
WITH w(t) AS (VALUES ('เก้าอี้'), ('กระเพรา'), ('ไก่'), ('ข้าวผัด'), ('โต๊ะ'))
SELECT string_agg(t, ' · ' ORDER BY t COLLATE "th-TH-x-icu") AS icu_th,
       string_agg(t, ' · ' ORDER BY t COLLATE "C")           AS byte_order
  FROM w;

DROP TABLE thai_search_probe;
