using ProjectManagementAPI.Domain;

namespace ProjectManagementAPI.Models;

/// <summary>
/// สมาชิกของ workspace — composite PK (workspace_id, user_id)
///
/// ไม่มีตาราง invite เพราะไม่ได้ใช้อีเมลเชิญ (ไม่มี SMTP dependency)
/// admin เพิ่มสมาชิกด้วยอีเมลของ user ที่สมัครไว้แล้ว
/// </summary>
public class WorkspaceMember
{
    public Guid WorkspaceId { get; set; }
    public Guid UserId { get; set; }
    public WorkspaceRole Role { get; set; } = WorkspaceRole.Member;
    public DateTimeOffset JoinedAt { get; set; }

    public Workspace? Workspace { get; set; }
    public User? User { get; set; }
}
