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

    /// <summary>
    /// slug ต้อง unique ทั้งระบบ การตรวจจึงต้องข้าม tenant โดยธรรมชาติ
    /// (ตอนสร้าง workspace ผู้เรียกยังไม่ได้เป็นสมาชิกของ workspace ไหนเลย)
    /// </summary>
    Task<bool> SlugExistsAsync(string slug, CancellationToken ct = default);
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
    //  ⚠️ ทั้ง where และ orderby ต้องอยู่ "ก่อน" projection
    //
    //     ถ้า project เป็น record ก่อนแล้วค่อย .Where(r => r.WorkspaceId == x)
    //     หรือ .OrderBy(r => r.Name) EF จะแปลเป็น SQL ไม่ได้แล้ว throw ตอน
    //     runtime (เจอสองรอบแล้ว: Stage B ที่ OrderBy และ Stage C ที่ Where)
    //
    //     วิธีกันคือรับเงื่อนไขเข้ามาเป็น parameter แล้วใส่ใน where เดียวกัน
    //     ไม่เปิดให้ผู้เรียกต่อ .Where() ท้าย IQueryable ที่ project แล้ว
    // ─────────────────────────────────────────────────────────────────────
    private IQueryable<WorkspaceMembershipRow> QueryMemberships(
        Guid userId, Guid? workspaceId = null, string? slug = null)
        => from member in db.WorkspaceMembers.IgnoreQueryFilters([AppDbContext.TenantFilter]).AsNoTracking()
           join workspace in db.Workspaces.IgnoreQueryFilters([AppDbContext.TenantFilter]).AsNoTracking()
               on member.WorkspaceId equals workspace.Id
           where member.UserId == userId
              && (workspaceId == null || workspace.Id == workspaceId)
              && (slug == null || workspace.Slug == slug)
           orderby workspace.Name
           select new WorkspaceMembershipRow(
               workspace.Id, workspace.Slug, workspace.Name, workspace.Icon, member.Role);

    public Task<List<WorkspaceMembershipRow>> ListMembershipsAsync(
        Guid userId, CancellationToken ct = default)
        => QueryMemberships(userId).ToListAsync(ct);

    public async Task<WorkspaceRole?> ResolveMembershipAsync(
        Guid userId, Guid workspaceId, CancellationToken ct = default)
    {
        var row = await QueryMemberships(userId, workspaceId: workspaceId)
            .FirstOrDefaultAsync(ct);

        return row?.Role;
    }

    public Task<WorkspaceMembershipRow?> ResolveMembershipBySlugAsync(
        Guid userId, string slug, CancellationToken ct = default)
        => QueryMemberships(userId, slug: slug).FirstOrDefaultAsync(ct);

    public Task<bool> SlugExistsAsync(string slug, CancellationToken ct = default)
        // ต้องเห็น workspace ที่ถูก soft-delete ด้วย — slug ของมันยังจองอยู่
        // (unique index ไม่สนใจ deleted_at) จึงปิดทั้งสอง filter ที่นี่
        => db.Workspaces
             .IgnoreQueryFilters([AppDbContext.TenantFilter, AppDbContext.SoftDeleteFilter])
             .AnyAsync(w => w.Slug == slug, ct);
}
