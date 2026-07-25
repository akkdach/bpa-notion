using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Repositories;

// ═══════════════════════════════════════════════════════════════════════════
//  PermissionQueries — ชั้นอ่านข้อมูลของการตรวจสิทธิ์
//
//  แยกออกมาจาก PermissionService เพราะ service แตะ AppDbContext ไม่ได้
//  (บังคับด้วย CI gate) การเขียนรวมกันไว้ตอนแรกทำให้ gate แดง ซึ่งถูกแล้ว
//
//  query ทุกตัวได้ประโยชน์จาก global query filter — ไม่มี `workspace_id =`
//  เขียนเองในไฟล์นี้เลย
// ═══════════════════════════════════════════════════════════════════════════
public class PermissionQueries(AppDbContext db) : IPermissionQueries
{
    public Task<bool> PageExistsAsync(Guid pageId, CancellationToken ct = default)
        => db.Pages.AnyAsync(p => p.Id == pageId, ct);

    // ─────────────────────────────────────────────────────────────────────
    //  query เดียวที่ความลึกคงที่
    //
    //  JOIN ที่ pages.access_root_id ไม่ใช่ pages.id — access_root_id ชี้ตรง
    //  ไปที่ ancestor ที่ใกล้ที่สุดซึ่งมี ACL อยู่แล้ว จึงไม่ต้องไล่ขึ้น tree
    //  ไม่ว่าหน้าจะซ้อนกันลึกกี่ชั้น
    // ─────────────────────────────────────────────────────────────────────
    public Task<List<AclGrant>> GetGrantsForPageAsync(
        Guid pageId, Guid userId, CancellationToken ct = default)
        => (from page in db.Pages.AsNoTracking()
            join acl in db.PageAcls.AsNoTracking() on page.AccessRootId equals acl.PageId
            where page.Id == pageId
               && ((acl.SubjectType == AclSubjectType.User && acl.SubjectId == userId)
                   || acl.SubjectType == AclSubjectType.Workspace)
            select new AclGrant(acl.SubjectType, acl.Role))
           .ToListAsync(ct);

    public Task<List<Guid>> GetVisibleAccessRootsAsync(
        Guid userId, bool includeWorkspaceWide, CancellationToken ct = default)
        => db.PageAcls.AsNoTracking()
             .Where(a => (a.SubjectType == AclSubjectType.User && a.SubjectId == userId)
                      || (includeWorkspaceWide && a.SubjectType == AclSubjectType.Workspace))
             .Select(a => a.PageId)
             .Distinct()
             .ToListAsync(ct);
}
