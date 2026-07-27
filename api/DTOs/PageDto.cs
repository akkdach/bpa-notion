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

// ═══════════════════════════════════════════════════════════════════════════
//  เนื้อหาหน้าเป็น plain text — ทางที่เซิร์ฟเวอร์และ AI อ่านเนื้อหาได้
//
//  ⚠️ เป็นข้อมูล derived ไม่ใช่ตัวเอกสารจริง เอกสารจริงเป็น Yjs CRDT ใน bytea
//     ที่เซิร์ฟเวอร์ไม่แกะโดยเจตนา (ดู PLAN.md การตัดสินใจข้อ 1-2) ข้อความที่นี่
//     คือสิ่งที่เบราว์เซอร์แกะแล้วส่งกลับมาให้ index ค้นหา
// ═══════════════════════════════════════════════════════════════════════════

/// <summary>ความน่าเชื่อถือของ plain text ที่คืนไป</summary>
public static class ContentFreshness
{
    /// <summary>
    /// ยังไม่เคยมีเบราว์เซอร์เปิดหน้านี้ — bodyText ว่างเพราะ "ไม่มีข้อมูล"
    /// ไม่ใช่เพราะ "หน้าว่าง" ผู้เรียกต้องแยกสองอย่างนี้ออก
    /// </summary>
    public const string Never = "never";

    /// <summary>เบราว์เซอร์แกะจากเอกสารจริงแล้วส่งมา — เชื่อได้เท่าที่ projectionUpdatedAt บอก</summary>
    public const string FromDocument = "from_document";
}

/// <param name="Freshness">ดู ContentFreshness — เป็นสามสถานะไม่ใช่ boolean โดยเจตนา</param>
/// <param name="PageUpdatedAt">เวลาที่ metadata ของหน้าถูกแก้ล่าสุด</param>
/// <param name="ProjectionUpdatedAt">
/// เวลาที่ plain text ถูกเขียนล่าสุด — null เมื่อ freshness = never
///
/// ถ้าค่านี้เก่ากว่า PageUpdatedAt แปลว่าอาจมีการแก้ที่ยังไม่สะท้อนมาถึงข้อความนี้
/// ผู้เรียกเทียบเองได้ เราไม่สรุปให้เพราะ PageUpdatedAt ขยับตอนเปลี่ยนสถานะ/ไอคอนด้วย
/// ซึ่งไม่ได้แปลว่าเนื้อหาเปลี่ยน
/// </param>
public record PageContentDto(
    Guid Id,
    string Title,
    string BodyText,
    string Freshness,
    DateTimeOffset PageUpdatedAt,
    DateTimeOffset? ProjectionUpdatedAt);

/// <param name="Paragraphs">
/// ข้อความ ย่อหน้าละหนึ่งรายการ — ขึ้นบรรทัดในตัวจะถูกแตกเป็นคนละย่อหน้าให้
/// (BlockNote ไม่มีโครงรองรับ newline ภายในย่อหน้าเดียว)
/// </param>
public record AppendParagraphsRequest(IReadOnlyList<string>? Paragraphs);
