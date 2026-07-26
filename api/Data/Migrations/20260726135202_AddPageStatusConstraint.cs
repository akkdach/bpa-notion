using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProjectManagementAPI.Data.Migrations
{
    // ═══════════════════════════════════════════════════════════════════════
    //  CHECK constraint ให้ pages.status
    //
    //  AddPageStatus เพิ่มคอลัมน์มาโดยไม่มี constraint ทำให้เป็นคอลัมน์แบบ enum
    //  เดียวในระบบที่ค่าขยะเข้าได้ — เหตุผลเต็มอยู่ใน
    //  Sql/005_page_status_constraint.sql
    //
    //  EF เขียน CHECK constraint เองไม่ได้ จึงมาเป็น raw SQL เหมือน constraint
    //  อื่นทั้งหมดในโปรเจกต์นี้ (ดู 001_check_constraints.sql)
    // ═══════════════════════════════════════════════════════════════════════
    /// <inheritdoc />
    public partial class AddPageStatusConstraint : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(MigrationSql.Load("005_page_status_constraint.sql"));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE pages DROP CONSTRAINT IF EXISTS ck_pages_status;");
        }
    }
}
