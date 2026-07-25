using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Services.Abstractions;

public interface IPageTreeService
{
    Task<Result<List<PageNodeDto>>> GetTreeAsync(CancellationToken ct = default);

    Task<Result<PageDto>> GetAsync(Guid pageId, CancellationToken ct = default);

    Task<Result<PageDto>> CreateAsync(CreatePageRequest request, CancellationToken ct = default);

    Task<Result<PageDto>> UpdateAsync(
        Guid pageId, UpdatePageRequest request, CancellationToken ct = default);

    /// <summary>ย้ายหน้าพร้อมลูกหลานทั้งหมด — ต้องเป็น UPDATE เดียวสำหรับ subtree</summary>
    Task<Result<MoveResultDto>> MoveAsync(
        Guid pageId, MovePageRequest request, CancellationToken ct = default);

    Task<Result<int>> DeleteAsync(Guid pageId, CancellationToken ct = default);

    Task<Result<int>> RestoreAsync(Guid pageId, CancellationToken ct = default);

    Task<Result<int>> PurgeAsync(Guid pageId, CancellationToken ct = default);

    Task<Result<List<PageNodeDto>>> GetTrashAsync(CancellationToken ct = default);

    // ═══════════════════════════════════════════════════════════════════════
    //  Repair — ancestor_ids และ access_root_id เป็นค่า denormalise
    //  ที่เพี้ยนได้ ต้องมีทางตรวจและทางซ่อมตั้งแต่วันแรก
    // ═══════════════════════════════════════════════════════════════════════

    Task<Result<TreeConsistency>> CheckConsistencyAsync(CancellationToken ct = default);

    Task<Result<RepairResultDto>> RepairAsync(CancellationToken ct = default);
}
