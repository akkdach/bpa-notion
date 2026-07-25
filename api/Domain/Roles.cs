namespace ProjectManagementAPI.Domain;

// ═══════════════════════════════════════════════════════════════════════════
//  Roles
//
//  เก็บใน DB เป็น text (มี check constraint) ไม่ใช่ int เพราะ:
//    · อ่าน SQL ดิบแล้วเข้าใจได้ทันที — เรามี raw SQL เยอะ (view query, PGroonga)
//    · แทรก enum member ตรงกลางแล้วความหมายของข้อมูลเดิมไม่เปลี่ยน
// ═══════════════════════════════════════════════════════════════════════════

/// <summary>สิทธิ์ระดับ workspace</summary>
public enum WorkspaceRole
{
    /// <summary>เห็นเฉพาะหน้าที่ถูกแชร์ให้ ไม่เห็น workspace ทั้งก้อน</summary>
    Guest = 0,
    Member = 1,
    Admin = 2,
    Owner = 3
}

/// <summary>สิทธิ์ระดับหน้า</summary>
public enum PageRole
{
    Viewer = 0,
    Commenter = 1,
    Editor = 2,
    /// <summary>แก้ได้ + จัดการสิทธิ์ของหน้านี้ได้</summary>
    Full = 3
}

public enum PageKind
{
    Page = 0,
    Database = 1,
    /// <summary>แถวใน database — เป็น page เต็มตัวที่มี properties</summary>
    DbRow = 2
}

public enum AclSubjectType
{
    User = 0,
    Group = 1,
    /// <summary>ทุกคนใน workspace (ยกเว้น guest)</summary>
    Workspace = 2
}

// ═══════════════════════════════════════════════════════════════════════════
//  ค่า string ที่ใช้ใน DB — ต้องตรงกับ check constraint ใน migration
// ═══════════════════════════════════════════════════════════════════════════
public static class RoleNames
{
    public static readonly IReadOnlyDictionary<WorkspaceRole, string> Workspace =
        new Dictionary<WorkspaceRole, string>
        {
            [WorkspaceRole.Owner] = "owner",
            [WorkspaceRole.Admin] = "admin",
            [WorkspaceRole.Member] = "member",
            [WorkspaceRole.Guest] = "guest"
        };

    public static readonly IReadOnlyDictionary<PageRole, string> Page =
        new Dictionary<PageRole, string>
        {
            [PageRole.Full] = "full",
            [PageRole.Editor] = "editor",
            [PageRole.Commenter] = "commenter",
            [PageRole.Viewer] = "viewer"
        };

    public static readonly IReadOnlyDictionary<PageKind, string> Kind =
        new Dictionary<PageKind, string>
        {
            [PageKind.Page] = "page",
            [PageKind.Database] = "database",
            [PageKind.DbRow] = "db_row"
        };

    public static readonly IReadOnlyDictionary<AclSubjectType, string> SubjectType =
        new Dictionary<AclSubjectType, string>
        {
            [AclSubjectType.User] = "user",
            [AclSubjectType.Group] = "group",
            [AclSubjectType.Workspace] = "workspace"
        };
}

public static class RoleExtensions
{
    public static string ToDbValue(this WorkspaceRole role) => RoleNames.Workspace[role];
    public static string ToDbValue(this PageRole role) => RoleNames.Page[role];
    public static string ToDbValue(this PageKind kind) => RoleNames.Kind[kind];
    public static string ToDbValue(this AclSubjectType type) => RoleNames.SubjectType[type];

    /// <summary>
    /// owner/admin ของ workspace มีสิทธิ์ full ทุกหน้าโดยไม่ต้องดู page_acl
    /// (short-circuit นี้ทำให้ permission query ไม่ต้องรันเลยในกรณีที่พบบ่อยที่สุด)
    /// </summary>
    public static bool IsWorkspaceWideEditor(this WorkspaceRole role)
        => role is WorkspaceRole.Owner or WorkspaceRole.Admin;

    /// <summary>สิทธิ์ที่แก้เนื้อหาได้</summary>
    public static bool CanEdit(this PageRole role)
        => role is PageRole.Editor or PageRole.Full;
}
