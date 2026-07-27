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

/// <summary>
/// ผู้รับสิทธิ์ในหนึ่งแถวของ page_acl
/// </summary>
/// <remarks>
/// ⚠️ ไม่มี Group โดยเจตนา — เคยมีค่า Group = 1 อยู่ตรงนี้พร้อม CHECK constraint
///    ที่ยอมรับ 'group' แต่ **ไม่มีตาราง groups/group_members อยู่จริงเลย** ค่านี้
///    จึงเป็นสถานะที่ระบบไม่มีทางสร้างได้ และทำให้ resolver มี branch ตายค้างไว้
///
///    constraint ที่อนุญาตสถานะซึ่งผลิตไม่ได้คือ constraint ที่หลอกคนอ่านโค้ด
///    ให้เชื่อว่าฟีเจอร์นั้นมีอยู่
///
///    ตอนทำ group จริงต้องเพิ่มสามอย่างพร้อมกัน: ตาราง groups + group_members,
///    ค่านี้กลับมาเป็น Group, และแก้ CHECK ck_page_acls_subject_type
///    (การ resolve สิทธิ์จะกลายเป็น multi-row + หา role สูงสุดในหน่วยความจำ
///     ไม่ใช่ LIMIT 1 แบบตอนนี้ — ดู PLAN.md เรื่อง nearest-ancestor-wins)
/// </remarks>
public enum AclSubjectType
{
    User = 0,
    /// <summary>ทุกคนใน workspace (ยกเว้น guest)</summary>
    Workspace = 2
}

// ═══════════════════════════════════════════════════════════════════════════
//  ประเภทของบัญชี
//
//  มีอยู่เพื่อให้ "เจ้าของตรวจงานได้" เป็นไปได้จริง — ถ้า AI ใช้บัญชีเดียวกับคน
//  last_edited_by จะเป็นค่าเดียวกันทั้งคู่ แล้วคำถามว่า "อันนี้ฉันแก้เองหรือ AI แก้"
//  ตอบไม่ได้เลย ซึ่งทำให้ประวัติการแก้ไขไม่มีประโยชน์
//
//  ⚠️ ไม่ใช่ระดับสิทธิ์ — agent ได้สิทธิ์จาก workspace_members เหมือนคนทุกอย่าง
//     คอลัมน์นี้บอกแค่ "ใครเป็นคนทำ" ไม่ได้บอกว่า "ทำอะไรได้"
//     อยากจำกัดขอบเขตของ AI ให้ใช้ role กับ page_acl ไม่ใช่ค่านี้
// ═══════════════════════════════════════════════════════════════════════════
public enum UserKind
{
    Human = 0,

    /// <summary>บัญชีที่ AI ใช้ผ่าน MCP server — ดู scripts/setup-mcp.ps1</summary>
    Agent = 1
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
            [AclSubjectType.Workspace] = "workspace"
        };

    public static readonly IReadOnlyDictionary<UserKind, string> Kinds =
        new Dictionary<UserKind, string>
        {
            [UserKind.Human] = "human",
            [UserKind.Agent] = "agent"
        };
}

public static class RoleExtensions
{
    public static string ToDbValue(this WorkspaceRole role) => RoleNames.Workspace[role];
    public static string ToDbValue(this PageRole role) => RoleNames.Page[role];
    public static string ToDbValue(this PageKind kind) => RoleNames.Kind[kind];
    public static string ToDbValue(this AclSubjectType type) => RoleNames.SubjectType[type];
    public static string ToDbValue(this UserKind kind) => RoleNames.Kinds[kind];

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
