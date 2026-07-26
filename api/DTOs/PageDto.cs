namespace ProjectManagementAPI.DTOs;

// ═══════════════════════════════════════════════════════════════════════════
//  Page
// ═══════════════════════════════════════════════════════════════════════════

/// <param name="ParentId">null = หน้าระดับบนสุด</param>
/// <param name="AfterPageId">แทรกต่อจากหน้านี้ — null = ต่อท้ายสุด</param>
public record CreatePageRequest(
    Guid? ParentId,
    string? Title,
    string? Icon,
    Guid? AfterPageId);

/// <param name="Status">สถานะงาน: todo / doing / done — "" (สตริงว่าง) = ล้างสถานะ (ไม่ใช่งาน)</param>
public record UpdatePageRequest(string? Title, string? Icon, string? CoverUrl, string? Status = null);

/// <param name="ParentId">parent ใหม่ — null = ย้ายขึ้นระดับบนสุด</param>
/// <param name="AfterPageId">วางต่อจากหน้านี้ในกลุ่มพี่น้องใหม่ — null = ท้ายสุด</param>
public record MovePageRequest(Guid? ParentId, Guid? AfterPageId);

public record PageDto(
    Guid Id,
    Guid? ParentId,
    IReadOnlyList<Guid> AncestorIds,
    int Depth,
    string Rank,
    string Kind,
    string Title,
    string? Icon,
    string? CoverUrl,
    string? Status,
    Guid AccessRootId,
    string MyRole,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? DeletedAt);

/// <summary>โหนดใน sidebar — เบากว่า PageDto เพราะโหลดทั้ง tree ทีเดียว</summary>
public record PageNodeDto(
    Guid Id,
    Guid? ParentId,
    string Title,
    string? Icon,
    string? Status,
    string Rank,
    int Depth,
    bool HasChildren,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? DeletedAt);

/// <param name="AffectedDescendants">จำนวนลูกหลานที่ถูกอัปเดตใน UPDATE เดียว</param>
public record MoveResultDto(PageDto Page, int AffectedDescendants);

public record RepairResultDto(int FixedAncestors, int FixedAccessRoots);

public record BreadcrumbDto(Guid Id, string Title, string? Icon);

// ═══════════════════════════════════════════════════════════════════════════
//  projection ที่ client แกะจาก Y.Doc ส่งกลับมา
//
//  เซิร์ฟเวอร์อ่าน Yjs ไม่ได้ (เก็บเป็น bytea ทึบ ๆ) จึงต้องให้ client เป็นคน
//  แปลงเป็น plain text ให้ ข้อมูลนี้ derived ทั้งหมด — ถ้าล้าสมัยผลค้นหา
//  ล้าสมัย แต่ไม่มีอะไรเสียหายและสร้างใหม่ได้เสมอ
// ═══════════════════════════════════════════════════════════════════════════
/// <param name="Links">
/// id ของหน้าที่ถูก mention ในเนื้อหา — เขียนทับทั้งชุดต่อหนึ่งหน้า (replace-all)
///
/// null = ไม่ได้ส่งมา ให้คงลิงก์เดิมไว้ (client รุ่นเก่าที่ยังไม่รู้จักช่องนี้)
/// [] = ส่งมาแต่ไม่มีลิงก์เลย ให้ลบทั้งหมด
/// ความต่างนี้สำคัญ ไม่งั้นการอัปเดต client จะล้างลิงก์ของทุกหน้าทิ้ง
/// </param>
public record ProjectionRequest(string? Title, string? PlainText, IReadOnlyList<Guid>? Links = null);

/// <summary>หน้าที่ลิงก์มาหาหน้านี้ (แผง backlinks)</summary>
public record BacklinkDto(Guid Id, string Title, string? Icon, DateTimeOffset UpdatedAt);
