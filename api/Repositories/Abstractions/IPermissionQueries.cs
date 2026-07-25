using ProjectManagementAPI.Domain;

namespace ProjectManagementAPI.Repositories.Abstractions;

/// <summary>grant หนึ่งแถวใน page_acls ที่ใช้กับผู้ใช้คนนี้</summary>
public record AclGrant(AclSubjectType SubjectType, PageRole Role);

public interface IPermissionQueries
{
    Task<bool> PageExistsAsync(Guid pageId, CancellationToken ct = default);

    /// <summary>grant ทั้งหมดที่ใช้กับคู่ (หน้า, ผู้ใช้) นี้ — query เดียว</summary>
    Task<List<AclGrant>> GetGrantsForPageAsync(
        Guid pageId, Guid userId, CancellationToken ct = default);

    /// <summary>
    /// access root ทั้งหมดที่ผู้ใช้มองเห็น
    /// ใช้กรองผลค้นหาด้วย access_root_id = ANY(...) ใน query เดียว
    /// </summary>
    Task<List<Guid>> GetVisibleAccessRootsAsync(
        Guid userId, bool includeWorkspaceWide, CancellationToken ct = default);
}
