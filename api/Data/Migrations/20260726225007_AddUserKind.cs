using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProjectManagementAPI.Data.Migrations
{
    // ═══════════════════════════════════════════════════════════════════════
    //  users.kind — คนหรือ AI
    //
    //  บัญชีที่มีอยู่แล้วทั้งหมดกลายเป็น 'human' ผ่าน default ของคอลัมน์
    //  ซึ่งถูกต้อง: ก่อนหน้านี้ยังไม่มีบัญชี agent เลย
    //
    //  CHECK constraint แยกไปอยู่ในไฟล์ .sql เหมือน constraint อื่นทั้งหมด
    //  (EF ไม่มี fluent API ให้เขียน CHECK)
    // ═══════════════════════════════════════════════════════════════════════
    /// <inheritdoc />
    public partial class AddUserKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "users",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "human");

            migrationBuilder.Sql(MigrationSql.Load("006_user_kind_constraint.sql"));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // constraint หายไปเองพร้อมคอลัมน์ แต่เขียนไว้ให้ชัดว่าไม่ได้ลืม
            migrationBuilder.Sql("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_kind;");

            migrationBuilder.DropColumn(
                name: "kind",
                table: "users");
        }
    }
}
