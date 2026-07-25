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

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }

    public ICollection<WorkspaceMember> Memberships { get; set; } = [];
}
