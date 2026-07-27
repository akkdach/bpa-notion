using ProjectManagementAPI.Domain;

namespace ProjectManagementAPI.Models;

public class User
{
    public Guid Id { get; set; }

    /// <summary>คอลัมน์เป็น citext — unique แบบไม่สนตัวพิมพ์เล็กใหญ่โดยไม่ต้องมี lower() index</summary>
    public string Email { get; set; } = string.Empty;

    public string PasswordHash { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public string Locale { get; set; } = "th";

    /// <summary>
    /// คนหรือ AI — ค่าเริ่มต้นเป็น Human ทุกบัญชีที่สมัครผ่าน /auth/register
    ///
    /// ทำให้ตอบได้ว่า "หน้านี้ AI แก้หรือฉันแก้" ซึ่งเป็นคำถามที่ตอบไม่ได้เลยเมื่อ
    /// MCP ใช้บัญชีเดียวกับเจ้าของ (last_edited_by เป็นค่าเดียวกันทั้งคู่)
    ///
    /// ⚠️ ไม่ใช่ระดับสิทธิ์ — ดูคอมเมนต์ที่ UserKind ใน Domain/Roles.cs
    /// </summary>
    public UserKind Kind { get; set; } = UserKind.Human;

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }

    public ICollection<WorkspaceMember> Memberships { get; set; } = [];
}
