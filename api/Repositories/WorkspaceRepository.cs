using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Repositories;

// ═══════════════════════════════════════════════════════════════════════════
//  WorkspaceRepository
//
//  ทุก method (ยกเว้น CreateWithOwnerAsync) พึ่ง global query filter ให้จำกัด
//  ขอบเขตเป็น workspace ปัจจุบันโดยอัตโนมัติ — จึงไม่มี `WHERE workspace_id =`
//  เขียนเองในไฟล์นี้เลย ซึ่งเป็นเรื่องดี: สิ่งที่ต้องเขียนเองคือสิ่งที่ลืมได้
// ═══════════════════════════════════════════════════════════════════════════
public class WorkspaceRepository(AppDbContext db, ITenantContext tenant) : IWorkspaceRepository
{
    public Task<Workspace> CreateWithOwnerAsync(
        Workspace workspace, Guid ownerId, CancellationToken ct = default)
        // ต้อง atomic — workspace ที่ไม่มี owner คือ workspace ที่ไม่มีใครเข้าถึงได้
        // และลบทิ้งก็ไม่ได้ (ต้องเป็น owner ถึงจะลบ)
        => db.InTransactionAsync(async token =>
        {
            db.Workspaces.Add(workspace);
            await db.SaveChangesAsync(token);

            db.WorkspaceMembers.Add(new WorkspaceMember
            {
                WorkspaceId = workspace.Id,
                UserId = ownerId,
                Role = WorkspaceRole.Owner
            });
            await db.SaveChangesAsync(token);

            return workspace;
        }, ct);

    public Task<Workspace?> GetCurrentAsync(CancellationToken ct = default)
        // query filter จำกัดให้เหลือ workspace ปัจจุบันอยู่แล้ว
        => db.Workspaces.AsNoTracking().FirstOrDefaultAsync(ct);

    public Task<int> CountMembersAsync(CancellationToken ct = default)
        => db.WorkspaceMembers.CountAsync(ct);

    public Task<List<MemberRow>> ListMembersAsync(CancellationToken ct = default)
        // ⚠️ OrderBy ต้องอยู่ก่อน projection ไม่งั้น EF แปลเป็น SQL ไม่ได้
        //    (เจอมาแล้วตอน Stage B)
        => (from member in db.WorkspaceMembers.AsNoTracking()
            join user in db.Users.AsNoTracking() on member.UserId equals user.Id
            orderby member.Role descending, user.Name
            select new MemberRow(
                user.Id, user.Email, user.Name, user.AvatarUrl,
                member.Role, user.Kind, member.JoinedAt))
           .ToListAsync(ct);

    public Task<WorkspaceMember?> FindMemberAsync(Guid userId, CancellationToken ct = default)
        => db.WorkspaceMembers.FirstOrDefaultAsync(m => m.UserId == userId, ct);

    public async Task AddMemberAsync(WorkspaceMember member, CancellationToken ct = default)
    {
        db.WorkspaceMembers.Add(member);
        await db.SaveChangesAsync(ct);
    }

    public Task UpdateMemberRoleAsync(
        Guid userId, WorkspaceRole role, CancellationToken ct = default)
        => db.WorkspaceMembers
             .Where(m => m.UserId == userId)
             .ExecuteUpdateAsync(s => s.SetProperty(m => m.Role, role), ct);

    public Task RemoveMemberAsync(Guid userId, CancellationToken ct = default)
        => db.WorkspaceMembers
             .Where(m => m.UserId == userId)
             .ExecuteDeleteAsync(ct);

    public Task<int> CountOwnersAsync(CancellationToken ct = default)
        => db.WorkspaceMembers.CountAsync(m => m.Role == WorkspaceRole.Owner, ct);

    public Task UpdateAsync(Workspace workspace, CancellationToken ct = default)
        => db.Workspaces
             .Where(w => w.Id == tenant.RequireWorkspaceId())
             .ExecuteUpdateAsync(s => s
                 .SetProperty(w => w.Name, workspace.Name)
                 .SetProperty(w => w.Icon, workspace.Icon), ct);
}
