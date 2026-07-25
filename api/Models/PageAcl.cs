using ProjectManagementAPI.Domain;

namespace ProjectManagementAPI.Models;

/// <summary>
/// สิทธิ์ระดับหน้า
///
/// หน้าที่ "ไม่มี" แถวใน page_acl = สืบทอดสิทธิ์จาก ancestor
/// หน้าที่ "มี" แถว = เป็น access root และหยุดการสืบทอด (nearest-ancestor-wins)
/// </summary>
public class PageAcl
{
    public Guid PageId { get; set; }
    public Guid WorkspaceId { get; set; }

    public AclSubjectType SubjectType { get; set; }

    /// <summary>
    /// user id หรือ group id
    ///
    /// ⚠️ เป็น Guid.Empty (ไม่ใช่ null) เมื่อ SubjectType = Workspace
    ///    เพราะคอลัมน์นี้เป็นส่วนของ primary key และ Postgres ไม่ยอมให้
    ///    คอลัมน์ใน PK เป็น NULL เลย
    /// </summary>
    public Guid SubjectId { get; set; }

    /// <summary>grant ที่ให้ทุกคนใน workspace</summary>
    public bool IsWorkspaceWide => SubjectType == AclSubjectType.Workspace;

    public static PageAcl ForWorkspace(Guid workspaceId, Guid pageId, PageRole role, Guid? grantedBy) => new()
    {
        WorkspaceId = workspaceId,
        PageId = pageId,
        SubjectType = AclSubjectType.Workspace,
        SubjectId = Guid.Empty,
        Role = role,
        GrantedBy = grantedBy
    };

    public static PageAcl ForUser(Guid workspaceId, Guid pageId, Guid userId, PageRole role, Guid? grantedBy) => new()
    {
        WorkspaceId = workspaceId,
        PageId = pageId,
        SubjectType = AclSubjectType.User,
        SubjectId = userId,
        Role = role,
        GrantedBy = grantedBy
    };

    public PageRole Role { get; set; }

    public Guid? GrantedBy { get; set; }
    public DateTimeOffset GrantedAt { get; set; }

    public Page? Page { get; set; }
}
