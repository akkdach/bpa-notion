using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;

namespace ProjectManagementAPI.Services.Abstractions;

public interface IWorkspaceService
{
    Task<Result<WorkspaceSummaryDto>> CreateAsync(
        CreateWorkspaceRequest request, Guid creatorId, CancellationToken ct = default);

    Task<Result<List<WorkspaceSummaryDto>>> ListMineAsync(
        Guid userId, CancellationToken ct = default);

    /// <summary>รายละเอียดของ workspace ปัจจุบัน (อ่านจาก tenant context)</summary>
    Task<Result<WorkspaceDetailDto>> GetCurrentAsync(CancellationToken ct = default);

    Task<Result<WorkspaceDetailDto>> UpdateAsync(
        UpdateWorkspaceRequest request, CancellationToken ct = default);

    Task<Result<List<MemberDto>>> ListMembersAsync(CancellationToken ct = default);

    Task<Result<MemberDto>> AddMemberAsync(
        AddMemberRequest request, CancellationToken ct = default);

    Task<Result> UpdateMemberRoleAsync(
        Guid userId, UpdateMemberRoleRequest request, CancellationToken ct = default);

    Task<Result> RemoveMemberAsync(Guid userId, CancellationToken ct = default);
}
