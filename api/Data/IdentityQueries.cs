using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Data;

// ═══════════════════════════════════════════════════════════════════════════
//  IdentityQueries — ทางเดียวในระบบที่ข้าม Tenant filter ได้โดยเจตนา
//
//  มี request บางประเภทที่ "ต้อง" ข้าม workspace จริง ๆ:
//    · login — ยังไม่รู้ว่าจะเข้า workspace ไหน
//    · GET /me/workspaces — ต้องเห็นทุก workspace ที่ตัวเองเป็นสมาชิก
//    · resolve สมาชิกภาพ — คือตัวที่จะ "ตั้ง" tenant context เอง
//
//  เหตุผลที่แยกเป็นไฟล์เดียว ไม่ใช่กระจายไปตาม service:
//  ทุกที่ที่ข้าม tenant filter คือความเสี่ยง การมีไฟล์เดียวทำให้ CI gate ตั้ง
//  ข้อยกเว้นได้ที่เดียว และ review ได้ครบ ไฟล์นี้จึงเป็นไฟล์เดียวที่อนุญาตให้มี
//  IgnoreQueryFilters([AppDbContext.TenantFilter])
//
//  ⚠️ ทุก method ในไฟล์นี้ต้อง filter ด้วย userId ที่ authenticated แล้วเสมอ
//     "ข้าม tenant" ไม่ได้แปลว่า "ไม่มีขอบเขต"
// ═══════════════════════════════════════════════════════════════════════════
public interface IIdentityQueries
{
    Task<User?> FindUserByEmailAsync(string email, CancellationToken ct = default);
    Task<User?> FindUserByIdAsync(Guid userId, CancellationToken ct = default);

    /// <summary>workspace ทั้งหมดที่ user เป็นสมาชิก — ข้าม tenant filter โดยเจตนา</summary>
    Task<List<WorkspaceMembershipRow>> ListMembershipsAsync(
        Guid userId, CancellationToken ct = default);

    /// <summary>
    /// ตรวจสมาชิกภาพเพื่อ "ตั้ง" tenant context
    /// null = ไม่ได้เป็นสมาชิก (ผู้เรียกต้องตอบ 404 ไม่ใช่ 403 — 403 บอกว่า
    /// workspace นี้มีอยู่จริง ซึ่งเป็นการรั่วข้อมูลข้าม tenant)
    /// </summary>
    Task<WorkspaceRole?> ResolveMembershipAsync(
        Guid userId, Guid workspaceId, CancellationToken ct = default);

    Task<WorkspaceMembershipRow?> ResolveMembershipBySlugAsync(
        Guid userId, string slug, CancellationToken ct = default);
}

public record WorkspaceMembershipRow(
    Guid WorkspaceId,
    string Slug,
    string Name,
    string? Icon,
    WorkspaceRole Role);

public class IdentityQueries(AppDbContext db) : IIdentityQueries
{
    public Task<User?> FindUserByEmailAsync(string email, CancellationToken ct = default)
        // Users ไม่มี tenant filter อยู่แล้ว จึงไม่ต้อง ignore อะไร
        => db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == email, ct);

    public Task<User?> FindUserByIdAsync(Guid userId, CancellationToken ct = default)
        => db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);

    // ─────────────────────────────────────────────────────────────────────
    //  ⚠️ IgnoreQueryFilters ระบุชื่อ filter เสมอ — ปิดแค่ Tenant
    //     SoftDelete filter ยังทำงานอยู่ workspace ที่ถูกลบจึงไม่โผล่มาเอง
    //     ไม่ต้องเขียน `w.DeletedAt == null` ซ้ำ
    //
    //  ⚠️ OrderBy ต้องอยู่ "ก่อน" projection
    //     ถ้า project เป็น record ก่อนแล้วค่อย OrderBy(r => r.Name) EF จะแปล
    //     เป็น SQL ไม่ได้และ throw ตอน runtime — เจอมาแล้วตอน Stage B
    // ─────────────────────────────────────────────────────────────────────
    private IQueryable<WorkspaceMembershipRow> MembershipsOf(Guid userId)
        => from member in db.WorkspaceMembers.IgnoreQueryFilters([AppDbContext.TenantFilter]).AsNoTracking()
           join workspace in db.Workspaces.IgnoreQueryFilters([AppDbContext.TenantFilter]).AsNoTracking()
               on member.WorkspaceId equals workspace.Id
           where member.UserId == userId
           orderby workspace.Name
           select new WorkspaceMembershipRow(
               workspace.Id, workspace.Slug, workspace.Name, workspace.Icon, member.Role);

    public Task<List<WorkspaceMembershipRow>> ListMembershipsAsync(
        Guid userId, CancellationToken ct = default)
        => MembershipsOf(userId).ToListAsync(ct);

    public async Task<WorkspaceRole?> ResolveMembershipAsync(
        Guid userId, Guid workspaceId, CancellationToken ct = default)
    {
        var row = await MembershipsOf(userId)
            .Where(r => r.WorkspaceId == workspaceId)
            .FirstOrDefaultAsync(ct);

        return row?.Role;
    }

    public Task<WorkspaceMembershipRow?> ResolveMembershipBySlugAsync(
        Guid userId, string slug, CancellationToken ct = default)
        => MembershipsOf(userId)
             .Where(r => r.Slug == slug)
             .FirstOrDefaultAsync(ct);
}
