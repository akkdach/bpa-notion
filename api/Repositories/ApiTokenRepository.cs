using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Repositories;

// ═══════════════════════════════════════════════════════════════════════════
//  ApiTokenRepository
//
//  ⚠️ ที่นี่คือที่ที่สองในระบบ (ต่อจาก IdentityQueries) ที่ต้องข้าม tenant filter
//     โดยเจตนา และด้วยเหตุผลเดียวกัน: มันทำงาน "ก่อน" ที่ระบบจะรู้ว่า request นี้
//     อยู่ workspace ไหน — เพราะตัว token เป็นคนบอก
//
//     ทุก query ที่ข้าม filter ในไฟล์นี้จึงต้องกรองด้วยค่าที่ยืนยันแล้วเอง:
//     ResolveAsync กรองด้วย token hash (256 บิตจาก CSPRNG) ส่วน method อื่น
//     กรองด้วย workspaceId ที่ผู้เรียกยืนยันสิทธิ์มาแล้ว
// ═══════════════════════════════════════════════════════════════════════════
public class ApiTokenRepository(AppDbContext db) : IApiTokenRepository
{
    /// <summary>
    /// เขียน last_used_at ถี่แค่ไหน
    /// </summary>
    /// <remarks>
    /// ⚠️ ถ้าเขียนทุก request ทุกการ "อ่าน" ผ่าน token จะกลายเป็นการ "เขียน" ฐาน
    ///    ซึ่งแพงและทำให้ read replica ใช้ไม่ได้ในอนาคต
    ///
    ///    ความละเอียดระดับ 5 นาทีพอสำหรับสิ่งที่คนใช้ค่านี้จริง ๆ คือ
    ///    "ใบนี้ยังมีใครใช้อยู่ไหม" ไม่ใช่ audit log รายคำขอ (ซึ่งคือ activity_log)
    /// </remarks>
    private static readonly TimeSpan TouchInterval = TimeSpan.FromMinutes(5);

    public async Task<ApiTokenPrincipal?> ResolveAsync(
        string tokenHash, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;

        // ─────────────────────────────────────────────────────────────────
        //  ตรวจสามอย่างในคิวรีเดียว: ใบใช้ได้ · workspace ยังอยู่ · ยังเป็นสมาชิก
        //
        //  ⚠️ ข้อสุดท้ายสำคัญที่สุด — ถอดบัญชี AI ออกจาก workspace แล้วต้องเข้า
        //     ไม่ได้ "ทันที" ไม่ใช่รอ token หมดอายุ ซึ่งเป็นเหตุผลเดียวกับที่
        //     ระบบไม่ฝัง workspace ลงใน JWT (ดู ITenantContext)
        // ─────────────────────────────────────────────────────────────────
        // ⚠️ IgnoreQueryFilters ต้องเรียกนอก lambda — collection expression `[...]`
        //    ใช้ใน expression tree ไม่ได้ (CS9175) การประกอบ source ไว้ก่อนแล้ว
        //    ค่อย Join จึงทั้งคอมไพล์ผ่านและอ่านง่ายกว่า subquery ซ้อน
        var members = db.WorkspaceMembers
            .IgnoreQueryFilters([AppDbContext.TenantFilter])
            .AsNoTracking();

        var liveWorkspaces = db.Workspaces
            .IgnoreQueryFilters([AppDbContext.TenantFilter])
            .AsNoTracking()
            .Where(w => w.DeletedAt == null);

        return await db.ApiTokens
            .AsNoTracking()
            .Where(t => t.TokenHash == tokenHash)
            .Where(t => t.RevokedAt == null)
            .Where(t => t.ExpiresAt == null || t.ExpiresAt > now)
            .Join(
                members,
                token => new { token.WorkspaceId, token.UserId },
                member => new { member.WorkspaceId, member.UserId },
                (token, member) => new { token, member.Role })
            .Join(
                liveWorkspaces,
                x => x.token.WorkspaceId,
                workspace => workspace.Id,
                (x, _) => new ApiTokenPrincipal(
                    x.token.Id, x.token.WorkspaceId, x.token.UserId, x.Role, x.token.LastUsedAt))
            .FirstOrDefaultAsync(ct);
    }

    public async Task TouchAsync(Guid tokenId, CancellationToken ct = default)
    {
        var cutoff = DateTimeOffset.UtcNow - TouchInterval;

        // เงื่อนไขเวลาอยู่ใน WHERE ไม่ใช่ใน C# — สอง request พร้อมกันจึงไม่เขียนซ้อนกัน
        await db.ApiTokens
            .Where(t => t.Id == tokenId)
            .Where(t => t.LastUsedAt == null || t.LastUsedAt < cutoff)
            .ExecuteUpdateAsync(
                s => s.SetProperty(t => t.LastUsedAt, DateTimeOffset.UtcNow), ct);
    }

    public async Task<ApiToken> AddAsync(ApiToken token, CancellationToken ct = default)
    {
        db.ApiTokens.Add(token);
        await db.SaveChangesAsync(ct);
        return token;
    }

    public Task<List<ApiToken>> ListAsync(Guid workspaceId, CancellationToken ct = default)
        => db.ApiTokens
             .AsNoTracking()
             .Where(t => t.WorkspaceId == workspaceId)
             .OrderByDescending(t => t.CreatedAt)
             .ToListAsync(ct);

    public async Task<bool> RevokeAsync(
        Guid workspaceId, Guid tokenId, CancellationToken ct = default)
    {
        // workspaceId อยู่ใน WHERE ด้วยเสมอ — ไม่งั้นรู้ id ใบเดียวก็เพิกถอน
        // ของ workspace อื่นได้
        var affected = await db.ApiTokens
            .Where(t => t.Id == tokenId && t.WorkspaceId == workspaceId && t.RevokedAt == null)
            .ExecuteUpdateAsync(
                s => s.SetProperty(t => t.RevokedAt, DateTimeOffset.UtcNow), ct);

        return affected > 0;
    }

    public Task<User?> FindAgentAsync(Guid workspaceId, CancellationToken ct = default)
        => db.WorkspaceMembers
             .IgnoreQueryFilters([AppDbContext.TenantFilter])
             .AsNoTracking()
             .Where(m => m.WorkspaceId == workspaceId)
             .Join(db.Users, m => m.UserId, u => u.Id, (m, u) => u)
             .Where(u => u.Kind == UserKind.Agent)
             .OrderBy(u => u.CreatedAt)
             .FirstOrDefaultAsync(ct);
}
