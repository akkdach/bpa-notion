using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Repositories.Abstractions;

public interface IPageRepository
{
    Task<Page?> GetAsync(Guid pageId, CancellationToken ct = default);

    /// <summary>อ่านหน้าที่ถูกลบด้วย (สำหรับ trash / restore)</summary>
    Task<Page?> GetIncludingDeletedAsync(Guid pageId, CancellationToken ct = default);

    /// <summary>ลูกโดยตรงของ parentId (null = ระดับบนสุด) เรียงตาม rank แล้ว id</summary>
    Task<List<PageNode>> ListChildrenAsync(Guid? parentId, CancellationToken ct = default);

    /// <summary>ทั้ง tree ของ workspace — Phase 1 โหลดทีเดียวพอ (จะทำ lazy ตอนโตขึ้น)</summary>
    Task<List<PageNode>> ListTreeAsync(CancellationToken ct = default);

    Task<List<PageNode>> ListTrashAsync(CancellationToken ct = default);

    /// <summary>rank ของลูกตัวสุดท้าย/ตัวแรก ใช้คำนวณตำแหน่งแทรก</summary>
    Task<(string? Before, string? After)> GetNeighbourRanksAsync(
        Guid? parentId, Guid? afterPageId, CancellationToken ct = default);

    /// <summary>
    /// สร้างหน้า พร้อม ACL (ถ้ามี) และแถวใน page_searches ในธุรกรรมเดียว
    /// </summary>
    /// <param name="acl">
    /// ACL ที่ต้องเกิดพร้อมหน้า — ใช้กับหน้าระดับบนสุดซึ่งเป็น access root ของตัวเอง
    /// null = หน้าลูกที่สืบทอดสิทธิ์จากพ่อ
    /// </param>
    Task<Page> AddAsync(Page page, PageAcl? acl = null, CancellationToken ct = default);

    Task UpdateTitleAsync(Guid pageId, string title, Guid editorId, CancellationToken ct = default);

    Task UpdateIconAsync(
        Guid pageId, string? icon, string? coverUrl, Guid editorId,
        CancellationToken ct = default);

    /// <summary>เซ็ตสถานะงาน (null = ล้างสถานะ ให้กลับเป็นหน้าปกติ)</summary>
    Task UpdateStatusAsync(Guid pageId, string? status, Guid editorId, CancellationToken ct = default);

    /// <summary>
    /// ย้ายหน้า (พร้อมลูกหลานทั้งหมด) ไปใต้ parent ใหม่
    /// ต้องเป็น UPDATE เดียวสำหรับ subtree ไม่ใช่ loop
    /// </summary>
    /// <param name="aclToAdd">
    /// ACL ที่ต้องเกิดพร้อมกับการย้ายในธุรกรรมเดียว — ใช้ตอนย้ายขึ้นระดับบนสุด
    /// โดยที่หน้านั้นยังไม่มี ACL ของตัวเอง null = ไม่ต้องเพิ่ม
    ///
    /// รับเข้ามาที่นี่แทนที่จะให้ service เรียก AddAclAsync แยก เพราะการ commit
    /// ACL ก่อนแล้วย้ายล้มทีหลัง = มอบสิทธิ์แก้ให้ทุกคนใน workspace บนหน้าที่
    /// ไม่ได้ย้าย โดยไม่มีใครสั่ง
    /// </param>
    Task<int> MoveSubtreeAsync(
        MoveSubtreeCommand command, PageAcl? aclToAdd = null, CancellationToken ct = default);

    /// <summary>soft delete หน้าและลูกหลานทั้งหมด</summary>
    Task<int> SoftDeleteSubtreeAsync(Guid pageId, CancellationToken ct = default);

    Task<int> RestoreSubtreeAsync(Guid pageId, CancellationToken ct = default);

    /// <summary>ลบถาวร — ใช้ตอนล้างถังขยะ</summary>
    Task<int> PurgeSubtreeAsync(Guid pageId, CancellationToken ct = default);

    Task<bool> HasOwnAclAsync(Guid pageId, CancellationToken ct = default);

    Task AddAclAsync(PageAcl acl, CancellationToken ct = default);

    // ═══════════════════════════════════════════════════════════════════════
    //  Repair — ค่าที่ denormalise ไว้เพี้ยนได้ ต้องมีทางซ่อมตั้งแต่วันแรก
    // ═══════════════════════════════════════════════════════════════════════

    /// <summary>
    /// สร้าง ancestor_ids และ depth ใหม่ทั้ง workspace จาก parent_id
    /// (parent_id คือความจริง มี FK บังคับ ส่วน ancestor_ids เป็นแค่ index)
    /// คืนจำนวนแถวที่ "เคยผิด"
    /// </summary>
    Task<int> RebuildAncestorIdsAsync(CancellationToken ct = default);

    /// <summary>คำนวณ access_root_id ใหม่ทั้ง workspace — คืนจำนวนแถวที่เคยผิด</summary>
    Task<int> RecomputeAccessRootsAsync(CancellationToken ct = default);

    /// <summary>ตรวจอย่างเดียวไม่แก้ — ใช้เป็น consistency check รายวัน</summary>
    Task<TreeConsistency> CheckConsistencyAsync(CancellationToken ct = default);
}

/// <param name="PageId">หน้าที่ถูกย้าย</param>
/// <param name="NewParentId">parent ใหม่ (null = ย้ายขึ้นระดับบนสุด)</param>
/// <param name="NewAncestorIds">ancestor_ids ชุดใหม่ของหน้าที่ถูกย้าย</param>
/// <param name="OldDepth">depth เดิม ใช้ตัดส่วนหน้าของ ancestor_ids ของลูกหลาน</param>
/// <param name="NewRank">ตำแหน่งใหม่ในหมู่พี่น้อง</param>
/// <param name="OldAccessRootId">access root เดิมของ subtree</param>
/// <param name="NewAccessRootId">access root ใหม่ (เท่าเดิมถ้าหน้านี้มี ACL ของตัวเอง)</param>
public record MoveSubtreeCommand(
    Guid PageId,
    Guid? NewParentId,
    Guid[] NewAncestorIds,
    int OldDepth,
    string NewRank,
    Guid OldAccessRootId,
    Guid NewAccessRootId);

public record PageNode(
    Guid Id,
    Guid? ParentId,
    string Title,
    string? Icon,
    string? Status,
    string Rank,
    int Depth,
    PageKind Kind,
    Guid AccessRootId,
    bool HasChildren,
    Guid? LastEditedBy,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? DeletedAt);

/// <param name="BadAncestors">แถวที่ ancestor_ids/depth ไม่ตรงกับ parent_id</param>
/// <param name="BadAccessRoots">แถวที่ access_root_id ไม่ตรงกับ ACL จริง</param>
/// <param name="Orphans">แถวที่ parent_id ชี้ไปหน้าที่ไม่มีอยู่หรือถูกลบ</param>
public record TreeConsistency(int BadAncestors, int BadAccessRoots, int Orphans)
{
    public bool IsHealthy => BadAncestors == 0 && BadAccessRoots == 0 && Orphans == 0;
}
