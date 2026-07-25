namespace ProjectManagementAPI.Models;

public class Workspace
{
    public Guid Id { get; set; }

    /// <summary>ใช้ใน URL: /w/{slug} — unique ทั้งระบบ</summary>
    public string Slug { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    /// <summary>emoji หรือ URL ของไอคอน</summary>
    public string? Icon { get; set; }

    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }

    public ICollection<WorkspaceMember> Members { get; set; } = [];
}
