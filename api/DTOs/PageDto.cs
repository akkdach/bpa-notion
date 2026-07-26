namespace ProjectManagementAPI.DTOs;

// ═══════════════════════════════════════════════════════════════════════════
//  Page
// ═══════════════════════════════════════════════════════════════════════════

/// <param name="ParentId">null = หน้าระดับบนสุด</param>
/// <param name="AfterPageId">แทรกต่อจากหน้านี้ — null = ต่อท้ายสุด</param>
/// <param name="Status">
/// สถานะงานเริ่มต้น: todo / doing / done — null = ไม่ใช่งาน
///
/// รับตอนสร้างเพื่อให้ "สร้างงานพร้อมสถานะ" เป็น request เดียว ก่อนหน้านี้ผู้เรียก
/// (mcp/) ต้อง POST แล้ว PATCH ตาม ซึ่งไม่ atomic — ล้มกลางทางแล้วเหลือหน้าที่
/// ไม่มีสถานะค้างอยู่ในระบบ
/// </param>
public record CreatePageRequest(
    Guid? ParentId,
    string? Title,
    string? Icon,
    Guid? AfterPageId,
    string? Status = null);

/// <param name="Status">สถานะงาน: todo / doing / done — "" (สตริงว่าง) = ล้างสถานะ (ไม่ใช่งาน)</param>
public record UpdatePageRequest(string? Title, string? Icon, string? CoverUrl, string? Status = null);

/// <param name="ParentId">parent ใหม่ — null = ย้ายขึ้นระดับบนสุด</param>
/// <param name="AfterPageId">วางต่อจากหน้านี้ในกลุ่มพี่น้องใหม่ — null = ท้ายสุด</param>
public record MovePageRequest(Guid? ParentId, Guid? AfterPageId);

/// <param name="LastEditedBy">
/// ใครแก้หน้านี้ครั้งล่าสุด — null เฉพาะข้อมูลเก่าก่อนที่จะเริ่มบันทึกค่านี้
///
/// ส่งเป็น id ไม่ใช่ชื่อ เพราะการ resolve ชื่อต้อง join users ซึ่ง PageNodeDto
/// ใช้ในการโหลด tree ทั้ง workspace ทีเดียว — จ่ายค่า join ต่อทุกโหนดไม่คุ้ม
/// ฝั่งที่ต้องโชว์ชื่อคน (ฟีดกิจกรรม) เป็นลิสต์ที่มีขอบเขต จึง resolve ที่นั่น
/// </param>
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
    Guid? LastEditedBy,
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
    Guid? LastEditedBy,
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
