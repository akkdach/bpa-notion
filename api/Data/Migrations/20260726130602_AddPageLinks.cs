using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProjectManagementAPI.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPageLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "page_links",
                columns: table => new
                {
                    source_page_id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_page_id = table.Column<Guid>(type: "uuid", nullable: false),
                    workspace_id = table.Column<Guid>(type: "uuid", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_page_links", x => new { x.source_page_id, x.target_page_id });
                    table.ForeignKey(
                        name: "fk_page_links_pages_workspace_id_source_page_id",
                        columns: x => new { x.workspace_id, x.source_page_id },
                        principalTable: "pages",
                        principalColumns: new[] { "workspace_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_page_links_pages_workspace_id_target_page_id",
                        columns: x => new { x.workspace_id, x.target_page_id },
                        principalTable: "pages",
                        principalColumns: new[] { "workspace_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_page_links_workspace_id_source_page_id",
                table: "page_links",
                columns: new[] { "workspace_id", "source_page_id" });

            migrationBuilder.CreateIndex(
                name: "ix_page_links_workspace_id_target_page_id",
                table: "page_links",
                columns: new[] { "workspace_id", "target_page_id" });

            // CHECK constraint + การบีบ ck_page_acls_subject_type ที่ EF เขียนเองไม่ได้
            migrationBuilder.Sql(MigrationSql.Load("004_page_links_and_acl_subject.sql"));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "page_links");

            // คืน CHECK เดิมที่ยอมรับ 'group' ให้ตรงกับสถานะก่อน migration นี้
            migrationBuilder.Sql("ALTER TABLE page_acls DROP CONSTRAINT IF EXISTS ck_page_acls_subject_type;");
            migrationBuilder.Sql(
                "ALTER TABLE page_acls ADD CONSTRAINT ck_page_acls_subject_type " +
                "CHECK (subject_type IN ('user', 'group', 'workspace'));");
        }
    }
}
