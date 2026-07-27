using System;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ProjectManagementAPI.Data.Migrations
{
    // ═══════════════════════════════════════════════════════════════════════
    //  page_notes + activity_logs
    //
    //  page_notes  — ช่องให้ AI เขียนข้อความเป็นภาษาคนโดยไม่ต้องแตะ Yjs
    //  activity_logs — ใครทำอะไรเมื่อไหร่ เพื่อให้เจ้าของตรวจงานที่ AI ทำได้
    //
    //  ⚠️ FK ของ activity_logs ถูกเขียนใหม่ด้วย raw SQL ตามหลัง
    //     EF สร้าง ON DELETE SET NULL แบบไม่ระบุคอลัมน์ ซึ่งจะ null ทั้ง
    //     (workspace_id, page_id) — และ workspace_id เป็น NOT NULL ทำให้
    //     "ลบถาวรหน้าที่มีประวัติไม่ได้เลย" ดู Sql/007_activity_log_fk.sql
    // ═══════════════════════════════════════════════════════════════════════
    /// <inheritdoc />
    public partial class AddNotesAndActivityLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "activity_logs",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    page_id = table.Column<Guid>(type: "uuid", nullable: true),
                    page_title = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    detail = table.Column<JsonDocument>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_activity_logs", x => x.id);
                    table.ForeignKey(
                        name: "fk_activity_logs_pages_workspace_id_page_id",
                        columns: x => new { x.workspace_id, x.page_id },
                        principalTable: "pages",
                        principalColumns: new[] { "workspace_id", "id" },
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "page_notes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    page_id = table.Column<Guid>(type: "uuid", nullable: false),
                    author_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    body = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_page_notes", x => x.id);
                    table.ForeignKey(
                        name: "fk_page_notes_pages_workspace_id_page_id",
                        columns: x => new { x.workspace_id, x.page_id },
                        principalTable: "pages",
                        principalColumns: new[] { "workspace_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_activity_logs_workspace_id_created_at",
                table: "activity_logs",
                columns: new[] { "workspace_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_activity_logs_workspace_id_page_id_created_at",
                table: "activity_logs",
                columns: new[] { "workspace_id", "page_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_page_notes_workspace_id_page_id_created_at",
                table: "page_notes",
                columns: new[] { "workspace_id", "page_id", "created_at" });

            // ต้องมาหลัง CreateTable — มัน DROP constraint ที่ EF เพิ่งสร้างแล้ว ADD ใหม่
            migrationBuilder.Sql(MigrationSql.Load("007_activity_log_fk.sql"));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "activity_logs");

            migrationBuilder.DropTable(
                name: "page_notes");
        }
    }
}
