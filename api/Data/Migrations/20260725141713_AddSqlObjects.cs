using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProjectManagementAPI.Data.Migrations
{
    // ═══════════════════════════════════════════════════════════════════════
    //  SQL ที่ EF migrations เขียนเองไม่ได้
    //
    //  ไฟล์ .sql อยู่ใน Data/Migrations/Sql/ และฝังเป็น embedded resource
    //  (ดู MigrationSql.cs) — เขียน SQL ในไฟล์ .sql ไม่ใช่ในสตริง C# เพราะ
    //  ต้อง review ได้จริง ใส่คอมเมนต์อธิบายได้ และ copy ไปลองใน psql ได้
    // ═══════════════════════════════════════════════════════════════════════
    /// <inheritdoc />
    public partial class AddSqlObjects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(MigrationSql.Load("001_check_constraints.sql"));
            migrationBuilder.Sql(MigrationSql.Load("002_indexes.sql"));
            migrationBuilder.Sql(MigrationSql.Load("003_pgroonga_indexes.sql"));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // ─── 003 ─────────────────────────────────────────────────────
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_page_searches_title_pgrn;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_page_searches_body_pgrn;");

            // ─── 002 ─────────────────────────────────────────────────────
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_page_doc_snapshots_latest;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_pages_trash;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_pages_computed_gin;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_pages_properties_gin;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_pages_database_rows;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_pages_ancestor_ids_gin;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_pages_sidebar;");

            // คืน index ที่ 002 drop ทิ้ง ให้กลับไปตรงกับที่ InitialCreate สร้าง
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_pages_workspace_id_parent_id_rank " +
                "ON pages (workspace_id, parent_id, rank);");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS ix_pages_database_id_rank " +
                "ON pages (database_id, rank);");

            // ─── 001 ─────────────────────────────────────────────────────
            migrationBuilder.Sql("ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS ck_workspaces_slug_format;");
            migrationBuilder.Sql("ALTER TABLE page_doc_updates DROP CONSTRAINT IF EXISTS ck_page_doc_updates_not_empty;");
            migrationBuilder.Sql("ALTER TABLE page_doc_snapshots DROP CONSTRAINT IF EXISTS ck_page_doc_snapshots_byte_size;");
            migrationBuilder.Sql("ALTER TABLE page_acls DROP CONSTRAINT IF EXISTS ck_page_acls_subject_id;");
            migrationBuilder.Sql("ALTER TABLE page_acls DROP CONSTRAINT IF EXISTS ck_page_acls_role;");
            migrationBuilder.Sql("ALTER TABLE page_acls DROP CONSTRAINT IF EXISTS ck_page_acls_subject_type;");
            migrationBuilder.Sql("ALTER TABLE pages DROP CONSTRAINT IF EXISTS ck_pages_no_self_ancestor;");
            migrationBuilder.Sql("ALTER TABLE pages DROP CONSTRAINT IF EXISTS ck_pages_depth_matches_ancestors;");
            migrationBuilder.Sql("ALTER TABLE pages DROP CONSTRAINT IF EXISTS ck_pages_db_row_has_database;");
            migrationBuilder.Sql("ALTER TABLE pages DROP CONSTRAINT IF EXISTS ck_pages_kind;");
            migrationBuilder.Sql("ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS ck_workspace_members_role;");
        }
    }
}
