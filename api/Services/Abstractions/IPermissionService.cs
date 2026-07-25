using ProjectManagementAPI.Domain;

namespace ProjectManagementAPI.Services.Abstractions;

// ═══════════════════════════════════════════════════════════════════════════
//  IPermissionService
//
//  สิทธิ์ของ "หน้า" หนึ่ง ๆ resolve ได้ด้วย query เดียวที่ความลึกคงที่
//  ไม่ว่า tree จะลึกกี่ชั้น เพราะ pages.access_root_id ชี้ตรงไปที่ ancestor
//  ที่ใกล้ที่สุดซึ่งมี ACL เป็นของตัวเอง
//
//  ลำดับการตัดสิน:
//    1. owner/admin ของ workspace → full ทันที ไม่ต้อง query เลย
//    2. JOIN page_acl ที่ access_root_id แล้วเอา role ที่สูงสุด
//    3. ไม่เจอเลย → ไม่มีสิทธิ์ (ผู้เรียกต้องตอบ 404 ไม่ใช่ 403)
// ═══════════════════════════════════════════════════════════════════════════
public interface IPermissionService
{
    /// <summary>null = ไม่มีสิทธิ์เห็นหน้านี้เลย</summary>
    Task<PageRole?> GetEffectiveRoleAsync(Guid pageId, CancellationToken ct = default);

    /// <summary>
    /// access root ทั้งหมดที่ user คนนี้มองเห็น
    /// ใช้กรองผลค้นหาด้วย `access_root_id = ANY(...)` ใน query เดียว
    /// แทนการเช็คสิทธิ์ทีละผลลัพธ์ (ซึ่งทำให้ LIMIT ใช้ไม่ได้)
    /// </summary>
    Task<IReadOnlyList<Guid>> GetVisibleAccessRootsAsync(CancellationToken ct = default);
}
