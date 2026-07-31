using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Repositories.Abstractions;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  PermissionService
//
//  ⚠️ ตัวนี้แตะ AppDbContext ไม่ได้ (CI gate) จึงอ่านผ่าน IPermissionQueries
//     ซึ่งอยู่ในชั้น repository
//
//  memo ระดับ request จำเป็น ไม่ใช่ optimisation: การ render sidebar ถาม
//  สิทธิ์หลายสิบครั้งต่อ request และคำตอบเปลี่ยนไม่ได้ระหว่าง request เดียวกัน
//
//  ⚠️ ห้ามทำ cache ข้าม request ที่อายุยาวเมื่อรัน api หลาย instance —
//     นั่นคือการ cache "สิทธิ์ที่ล้าสมัย" แยกกันคนละเครื่อง
// ═══════════════════════════════════════════════════════════════════════════
public class PermissionService(
    IPermissionQueries queries,
    ITenantContext tenant) : IPermissionService
{
    private readonly Dictionary<Guid, PageRole?> _memo = [];
    private IReadOnlyList<Guid>? _visibleRoots;

    public async Task<PageRole?> GetEffectiveRoleAsync(
        Guid pageId, CancellationToken ct = default)
    {
        if (_memo.TryGetValue(pageId, out var cached)) return cached;

        var role = await ResolveAsync(pageId, ct);
        _memo[pageId] = role;
        return role;
    }

    /// <remarks>
    /// ไม่ memo โดยเจตนา — เรียกครั้งเดียวต่อการกู้คืนหนึ่งครั้ง และการใช้ _memo
    /// ร่วมกับตัวปกติจะทำให้คำตอบของสองคำถามที่ต่างกันปนกันภายใต้ key เดียว
    /// </remarks>
    public async Task<PageRole?> GetEffectiveRoleForDeletedAsync(
        Guid pageId, CancellationToken ct = default)
    {
        var workspaceRole = tenant.WorkspaceRole
            ?? throw new InvalidOperationException(
                "ไม่มี WorkspaceRole ใน tenant context — endpoint ลืมใส่ [RequireWorkspace]");

        // owner/admin ไม่เดินมาทางนี้อยู่แล้ว (ผู้เรียกลัดไปก่อน) แต่ถ้าเดินมา
        // ก็ต้องได้คำตอบเดิม ไม่ใช่ null เพราะ PageExistsAsync มองไม่เห็นหน้าที่ถูกลบ
        if (workspaceRole.IsWorkspaceWideEditor()) return PageRole.Full;

        var grants = await queries.GetGrantsForDeletedPageAsync(
            pageId, tenant.RequireUserId(), ct);

        return Highest(grants, workspaceRole);
    }

    private async Task<PageRole?> ResolveAsync(Guid pageId, CancellationToken ct)
    {
        var workspaceRole = tenant.WorkspaceRole
            ?? throw new InvalidOperationException(
                "ไม่มี WorkspaceRole ใน tenant context — endpoint ลืมใส่ [RequireWorkspace]");

        // ─── ทางลัดที่ใช้บ่อยที่สุด: owner/admin เห็นทุกหน้า ───────────────
        // ไม่ต้อง query เลย ซึ่งครอบคลุม request ส่วนใหญ่ในทีมขนาดเล็ก
        if (workspaceRole.IsWorkspaceWideEditor())
        {
            // ยังต้องยืนยันว่าหน้านี้มีอยู่จริงใน workspace นี้ ไม่งั้นจะตอบว่า
            // "มีสิทธิ์" กับ id ที่เดามาแบบมั่ว ๆ
            return await queries.PageExistsAsync(pageId, ct) ? PageRole.Full : null;
        }

        // ─── query เดียว ความลึกคงที่ ────────────────────────────────────
        // JOIN ที่ access_root_id ทำให้ไม่ต้องไล่ขึ้น tree ทีละชั้น
        var grants = await queries.GetGrantsForPageAsync(pageId, tenant.RequireUserId(), ct);

        return Highest(grants, workspaceRole);
    }

    private static PageRole? Highest(List<AclGrant> grants, WorkspaceRole workspaceRole)
    {
        if (grants.Count == 0) return null;

        // guest เห็นเฉพาะหน้าที่ถูกแชร์ให้ "ตัวเขาเอง" — grant ระดับ workspace
        // ไม่นับ ไม่งั้น guest จะเห็นทุกหน้าใน workspace ทันทีที่ถูกเชิญ
        var applicable = workspaceRole == WorkspaceRole.Guest
            ? grants.Where(g => g.SubjectType != AclSubjectType.Workspace).ToList()
            : grants;

        if (applicable.Count == 0) return null;

        // เรียงลำดับความสูงของสิทธิ์ในหน่วยความจำ — ค่าในฐานเป็น text
        // การ ORDER BY ใน SQL จะได้ลำดับตามตัวอักษร (commenter < editor < full
        // < viewer) ซึ่งไม่ใช่ลำดับความสูงของสิทธิ์
        return applicable.Max(g => g.Role);
    }

    public async Task<IReadOnlyList<Guid>> GetVisibleAccessRootsAsync(
        CancellationToken ct = default)
    {
        if (_visibleRoots is not null) return _visibleRoots;

        var workspaceRole = tenant.WorkspaceRole ?? WorkspaceRole.Guest;

        _visibleRoots = await queries.GetVisibleAccessRootsAsync(
            tenant.RequireUserId(),
            includeWorkspaceWide: workspaceRole != WorkspaceRole.Guest,
            ct);

        return _visibleRoots;
    }
}
