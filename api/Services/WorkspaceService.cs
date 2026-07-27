using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Mapping;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  WorkspaceService
//
//  การเพิ่มสมาชิกใช้ "อีเมลของ user ที่สมัครไว้แล้ว" ไม่มีการเชิญทางอีเมล
//  (ตามที่ตกลงไว้ — ไม่มี SMTP dependency ในระบบนี้)
// ═══════════════════════════════════════════════════════════════════════════
public class WorkspaceService(
    IWorkspaceRepository workspaces,
    IUserRepository users,
    IIdentityQueries identity,
    ITenantContext tenant,
    ILogger<WorkspaceService> logger) : IWorkspaceService
{
    /// <summary>กันการวนหา slug ไม่รู้จบเมื่อชนกันซ้ำ ๆ</summary>
    private const int MaxSlugAttempts = 5;

    public async Task<Result<WorkspaceSummaryDto>> CreateAsync(
        CreateWorkspaceRequest request, Guid creatorId, CancellationToken ct = default)
    {
        var name = request.Name.Trim();

        var slugResult = await ResolveSlugAsync(request.Slug, name, ct);
        if (slugResult.IsFailure) return slugResult.Error;

        var workspace = await workspaces.CreateWithOwnerAsync(new Workspace
        {
            Slug = slugResult.Value,
            Name = name,
            Icon = request.Icon,
            CreatedBy = creatorId
        }, creatorId, ct);

        logger.LogInformation(
            "สร้าง workspace {WorkspaceId} ({Slug}) โดย {UserId}",
            workspace.Id, workspace.Slug, creatorId);

        return workspace.ToSummaryDto(WorkspaceRole.Owner);
    }

    public async Task<Result<List<WorkspaceSummaryDto>>> ListMineAsync(
        Guid userId, CancellationToken ct = default)
    {
        var rows = await identity.ListMembershipsAsync(userId, ct);
        return rows.Select(r => r.ToSummaryDto()).ToList();
    }

    public async Task<Result<WorkspaceDetailDto>> GetCurrentAsync(CancellationToken ct = default)
    {
        var workspace = await workspaces.GetCurrentAsync(ct);

        // middleware ตรวจสมาชิกภาพมาแล้ว ถ้ามาถึงตรงนี้แล้วไม่เจอแปลว่า
        // workspace ถูกลบระหว่างทาง
        if (workspace is null) return WorkspaceNotFound;

        var memberCount = await workspaces.CountMembersAsync(ct);

        return new WorkspaceDetailDto(
            workspace.Id,
            workspace.Slug,
            workspace.Name,
            workspace.Icon,
            RequireRole().ToDbValue(),
            memberCount,
            workspace.CreatedAt);
    }

    public async Task<Result<WorkspaceDetailDto>> UpdateAsync(
        UpdateWorkspaceRequest request, CancellationToken ct = default)
    {
        if (!RequireRole().IsWorkspaceWideEditor())
        {
            return Error.Forbidden("ต้องเป็น owner หรือ admin เท่านั้น", "insufficient_role");
        }

        var workspace = await workspaces.GetCurrentAsync(ct);
        if (workspace is null) return WorkspaceNotFound;

        workspace.Name = request.Name.Trim();
        workspace.Icon = request.Icon;
        await workspaces.UpdateAsync(workspace, ct);

        return await GetCurrentAsync(ct);
    }

    public async Task<Result<List<MemberDto>>> ListMembersAsync(CancellationToken ct = default)
    {
        var rows = await workspaces.ListMembersAsync(ct);

        return rows.Select(r => new MemberDto(
            r.UserId, r.Email, r.Name, r.AvatarUrl,
            r.Role.ToDbValue(), r.Kind.ToDbValue(), r.JoinedAt)).ToList();
    }

    public async Task<Result<MemberDto>> AddMemberAsync(
        AddMemberRequest request, CancellationToken ct = default)
    {
        if (!RequireRole().IsWorkspaceWideEditor())
        {
            return Error.Forbidden("ต้องเป็น owner หรือ admin เท่านั้น", "insufficient_role");
        }

        if (!TryParseWorkspaceRole(request.Role, out var role))
        {
            return Error.Validation($"ไม่รู้จักสิทธิ์ '{request.Role}'", "invalid_role");
        }

        // owner แต่งตั้ง owner ได้เท่านั้น — admin ยกระดับตัวเองไม่ได้ผ่านทางอ้อม
        if (role == WorkspaceRole.Owner && RequireRole() != WorkspaceRole.Owner)
        {
            return Error.Forbidden("เฉพาะ owner เท่านั้นที่แต่งตั้ง owner ได้", "insufficient_role");
        }

        var user = await identity.FindUserByEmailAsync(request.Email.Trim(), ct);

        if (user is null)
        {
            // ระบบนี้ไม่มีการเชิญทางอีเมล ผู้ใช้ต้องสมัครเองก่อน
            return Error.NotFound(
                "ไม่พบผู้ใช้ที่ใช้อีเมลนี้ — ให้ผู้ใช้สมัครสมาชิกก่อนแล้วค่อยเพิ่มเข้า workspace",
                "user_not_registered");
        }

        if (await workspaces.FindMemberAsync(user.Id, ct) is not null)
        {
            return Error.Conflict("ผู้ใช้นี้เป็นสมาชิกอยู่แล้ว", "already_member");
        }

        var member = new WorkspaceMember
        {
            WorkspaceId = tenant.RequireWorkspaceId(),
            UserId = user.Id,
            Role = role
        };
        await workspaces.AddMemberAsync(member, ct);

        logger.LogInformation(
            "เพิ่ม {UserId} เข้า workspace {WorkspaceId} เป็น {Role}",
            user.Id, member.WorkspaceId, role);

        return new MemberDto(
            user.Id, user.Email, user.Name, user.AvatarUrl,
            role.ToDbValue(), user.Kind.ToDbValue(), member.JoinedAt);
    }

    public async Task<Result> UpdateMemberRoleAsync(
        Guid userId, UpdateMemberRoleRequest request, CancellationToken ct = default)
    {
        if (!RequireRole().IsWorkspaceWideEditor())
        {
            return Error.Forbidden("ต้องเป็น owner หรือ admin เท่านั้น", "insufficient_role");
        }

        if (!TryParseWorkspaceRole(request.Role, out var role))
        {
            return Error.Validation($"ไม่รู้จักสิทธิ์ '{request.Role}'", "invalid_role");
        }

        var member = await workspaces.FindMemberAsync(userId, ct);
        if (member is null) return MemberNotFound;

        if (role == WorkspaceRole.Owner && RequireRole() != WorkspaceRole.Owner)
        {
            return Error.Forbidden("เฉพาะ owner เท่านั้นที่แต่งตั้ง owner ได้", "insufficient_role");
        }

        // ─────────────────────────────────────────────────────────────────
        //  กัน workspace กำพร้า: ถ้าลดสิทธิ์ owner คนสุดท้าย จะไม่เหลือใคร
        //  ที่ลบ workspace หรือแต่งตั้ง owner คนใหม่ได้อีกเลย
        // ─────────────────────────────────────────────────────────────────
        if (member.Role == WorkspaceRole.Owner && role != WorkspaceRole.Owner)
        {
            if (await workspaces.CountOwnersAsync(ct) <= 1)
            {
                return Error.Conflict(
                    "ต้องมี owner อย่างน้อยหนึ่งคน — แต่งตั้ง owner คนใหม่ก่อน",
                    "last_owner");
            }
        }

        await workspaces.UpdateMemberRoleAsync(userId, role, ct);

        // ─────────────────────────────────────────────────────────────────
        //  ประเภทบัญชี (คน / AI) — ไม่บังคับ ส่งมาเมื่อต้องการเปลี่ยนเท่านั้น
        //
        //  ตั้งหลัง role เพราะ role เป็นเรื่องหลักของ endpoint นี้ ถ้า kind ผิดรูป
        //  เราอยากให้ 400 ก่อนที่จะเขียนอะไรเลย จึง parse ไว้ตั้งแต่ต้น method ไม่ได้
        //  — แต่ก็ยอมรับได้เพราะสองการเขียนนี้ไม่ต้อง atomic ต่อกัน (คนละความหมาย
        //  และไม่มี invariant ร่วม)
        // ─────────────────────────────────────────────────────────────────
        if (request.Kind is not null)
        {
            if (!TryParseUserKind(request.Kind, out var kind))
            {
                return Error.Validation(
                    $"ไม่รู้จักประเภทบัญชี '{request.Kind}' — ต้องเป็น " +
                    $"{string.Join(" หรือ ", RoleNames.Kinds.Values)}",
                    "invalid_user_kind");
            }

            await users.UpdateKindAsync(userId, kind, ct);

            logger.LogInformation(
                "ตั้งประเภทบัญชี {UserId} เป็น {Kind} โดย {ActorId}",
                userId, kind, tenant.RequireUserId());
        }

        return Result.Success();
    }

    private static bool TryParseUserKind(string value, out UserKind kind)
    {
        var normalised = value.Trim().ToLowerInvariant();

        foreach (var (candidate, name) in RoleNames.Kinds)
        {
            if (string.Equals(name, normalised, StringComparison.Ordinal))
            {
                kind = candidate;
                return true;
            }
        }

        kind = UserKind.Human;
        return false;
    }

    public async Task<Result> RemoveMemberAsync(Guid userId, CancellationToken ct = default)
    {
        var isSelf = userId == tenant.RequireUserId();

        // ออกจาก workspace เองได้เสมอ แต่การถอดคนอื่นต้องมีสิทธิ์
        if (!isSelf && !RequireRole().IsWorkspaceWideEditor())
        {
            return Error.Forbidden("ต้องเป็น owner หรือ admin เท่านั้น", "insufficient_role");
        }

        var member = await workspaces.FindMemberAsync(userId, ct);
        if (member is null) return MemberNotFound;

        if (member.Role == WorkspaceRole.Owner && await workspaces.CountOwnersAsync(ct) <= 1)
        {
            return Error.Conflict(
                "ต้องมี owner อย่างน้อยหนึ่งคน — แต่งตั้ง owner คนใหม่ก่อน",
                "last_owner");
        }

        await workspaces.RemoveMemberAsync(userId, ct);

        logger.LogInformation(
            "ถอด {UserId} ออกจาก workspace {WorkspaceId}", userId, tenant.WorkspaceId);

        return Result.Success();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  helpers
    // ═══════════════════════════════════════════════════════════════════════

    private async Task<Result<string>> ResolveSlugAsync(
        string? requested, string name, CancellationToken ct)
    {
        // slug ที่ผู้ใช้ระบุเอง — ชนแล้วต้องแจ้ง ไม่ใช่เงียบ ๆ เปลี่ยนให้
        if (!string.IsNullOrWhiteSpace(requested))
        {
            var normalized = SlugGenerator.TryNormalize(requested);

            if (normalized is null)
            {
                return Error.Validation(
                    "slug ต้องมีตัวอักษรภาษาอังกฤษหรือตัวเลขอย่างน้อย 3 ตัว",
                    "invalid_slug");
            }

            return await identity.SlugExistsAsync(normalized, ct)
                ? Error.Conflict($"slug '{normalized}' ถูกใช้แล้ว", "slug_taken")
                : normalized;
        }

        // slug ที่ระบบสร้างเอง — ชนแล้วเติมท้ายให้เงียบ ๆ ได้ เพราะผู้ใช้ไม่ได้เลือก
        var candidate = SlugGenerator.FromName(name);

        for (var attempt = 0; attempt < MaxSlugAttempts; attempt++)
        {
            if (!await identity.SlugExistsAsync(candidate, ct)) return candidate;
            candidate = SlugGenerator.WithSuffix(SlugGenerator.FromName(name));
        }

        // ถึงตรงนี้แปลว่าสุ่มชนกัน 5 ครั้งติด ซึ่งแทบเป็นไปไม่ได้
        logger.LogError("หา slug ที่ว่างไม่ได้หลังลอง {Attempts} ครั้ง", MaxSlugAttempts);
        return Error.Conflict("สร้าง slug ไม่สำเร็จ กรุณาระบุ slug เอง", "slug_generation_failed");
    }

    /// <summary>middleware ตั้งค่านี้ให้แล้วก่อนเข้า controller ที่มี [RequireWorkspace]</summary>
    private WorkspaceRole RequireRole() => tenant.WorkspaceRole
        ?? throw new InvalidOperationException(
            "ไม่มี WorkspaceRole ใน tenant context — endpoint ลืมใส่ [RequireWorkspace]");

    private static bool TryParseWorkspaceRole(string value, out WorkspaceRole role)
    {
        foreach (var (candidate, name) in RoleNames.Workspace)
        {
            if (string.Equals(name, value, StringComparison.OrdinalIgnoreCase))
            {
                role = candidate;
                return true;
            }
        }

        role = default;
        return false;
    }

    private static Error WorkspaceNotFound =>
        Error.NotFound("ไม่พบ workspace", "workspace_not_found");

    private static Error MemberNotFound =>
        Error.NotFound("ไม่พบสมาชิกคนนี้", "member_not_found");
}
