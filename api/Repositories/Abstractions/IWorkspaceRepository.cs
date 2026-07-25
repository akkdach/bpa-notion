using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Repositories.Abstractions;

public interface IWorkspaceRepository
{
    /// <summary>สร้าง workspace พร้อมใส่ผู้สร้างเป็น owner ในทรานแซกชันเดียว</summary>
    Task<Workspace> CreateWithOwnerAsync(
        Workspace workspace, Guid ownerId, CancellationToken ct = default);

    /// <summary>workspace ปัจจุบันตาม tenant context — null ถ้าไม่มีหรือถูกลบ</summary>
    Task<Workspace?> GetCurrentAsync(CancellationToken ct = default);

    Task<int> CountMembersAsync(CancellationToken ct = default);

    Task<List<MemberRow>> ListMembersAsync(CancellationToken ct = default);

    Task<WorkspaceMember?> FindMemberAsync(Guid userId, CancellationToken ct = default);

    Task AddMemberAsync(WorkspaceMember member, CancellationToken ct = default);

    Task UpdateMemberRoleAsync(Guid userId, WorkspaceRole role, CancellationToken ct = default);

    Task RemoveMemberAsync(Guid userId, CancellationToken ct = default);

    /// <summary>จำนวน owner ที่เหลือ — ใช้กันไม่ให้ owner คนสุดท้ายถูกถอด</summary>
    Task<int> CountOwnersAsync(CancellationToken ct = default);

    Task UpdateAsync(Workspace workspace, CancellationToken ct = default);
}

public record MemberRow(
    Guid UserId,
    string Email,
    string Name,
    string? AvatarUrl,
    WorkspaceRole Role,
    DateTimeOffset JoinedAt);
