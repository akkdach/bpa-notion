-- ═══════════════════════════════════════════════════════════════════════════
--  Extensions — runs ONCE, on first container boot, via
--  /docker-entrypoint-initdb.d. It does NOT run again on an existing volume.
--
--  ถ้าแก้ไฟล์นี้แล้วอยากให้มีผล ต้อง `docker compose down -v` (ลบ volume)
--  หรือรัน statement เพิ่มเองด้วย psql
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── pgroonga ──────────────────────────────────────────────────────────────
-- Full-text search that actually works on Thai. Postgres's built-in tsvector
-- parser splits on whitespace, and Thai has none — to_tsvector() would return
-- one giant garbage token per page. See PLAN.md "Thai full-text search".
CREATE EXTENSION IF NOT EXISTS pgroonga;

-- ─── pgcrypto ──────────────────────────────────────────────────────────────
-- gen_random_uuid() for primary keys, digest() for hashing refresh tokens.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── citext ────────────────────────────────────────────────────────────────
-- users.email is citext: case-insensitive uniqueness without lower() indexes
-- scattered through every query.
CREATE EXTENSION IF NOT EXISTS citext;

-- ═══════════════════════════════════════════════════════════════════════════
--  Sanity check — surfaces in `docker compose logs postgres` on first boot
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
        RAISE EXCEPTION 'Required extensions missing: %', missing;
    END IF;

    RAISE NOTICE 'Extensions OK: pgroonga, pgcrypto, citext';
    RAISE NOTICE 'Collation check: th-TH-x-icu available = %',
        EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'th-TH-x-icu');
END $$;
