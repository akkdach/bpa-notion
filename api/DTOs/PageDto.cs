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

public record UpdatePageRequest(string? Title, string? Icon, string? CoverUrl);

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
    string Rank,
    int Depth,
    bool HasChildren,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? DeletedAt);

/// <param name="AffectedDescendants">จำนวนลูกหลานที่ถูกอัปเดตใน UPDATE เดียว</param>
public record MoveResultDto(PageDto Page, int AffectedDescendants);

public record RepairResultDto(int FixedAncestors, int FixedAccessRoots);

public record BreadcrumbDto(Guid Id, string Title, string? Icon);
