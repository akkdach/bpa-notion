using System.Security.Cryptography;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  ApiTokenService — ออกและเพิกถอนกุญแจของเครื่องภายนอก (MCP)
//
//  สิ่งที่ลูกค้าเห็นคือ "กดสร้าง token แล้วคัดลอกไปวาง" ส่วนบัญชี agent ที่ token
//  ทำงานแทนถูกสร้างให้อัตโนมัติเบื้องหลัง — เป็นรายละเอียดที่จำเป็นต่อการระบุ
//  ตัวผู้ทำ (activity_log, last_edited_by) แต่ไม่ใช่สิ่งที่ลูกค้าต้องจัดการเอง
// ═══════════════════════════════════════════════════════════════════════════
public class ApiTokenService(
    IApiTokenRepository tokens,
    IUserRepository users,
    IWorkspaceRepository workspaces,
    ITokenService tokenService,
    IPasswordHasher hasher,
    ITenantContext tenant,
    ILogger<ApiTokenService> logger) : IApiTokenService
{
    private const int MaxNameLength = 100;
    private const int MaxActiveTokens = 20;

    public async Task<Result<CreatedApiTokenDto>> CreateAsync(
        CreateApiTokenRequest request, CancellationToken ct = default)
    {
        if (!RequireRole().IsWorkspaceWideEditor())
            return Error.Forbidden("ต้องเป็น owner หรือ admin เท่านั้น", "insufficient_role");

        var name = (request.Name ?? string.Empty).Trim();

        if (name.Length == 0)
            return Error.Validation("ตั้งชื่อ token ด้วย เช่นชื่อเครื่องที่จะใช้", "token_name_required");

        if (name.Length > MaxNameLength)
            return Error.Validation($"ชื่อยาวเกิน {MaxNameLength} ตัวอักษร", "token_name_too_long");

        if (request.ExpiresInDays is { } days && days <= 0)
            return Error.Validation("จำนวนวันต้องมากกว่าศูนย์", "invalid_expiry");

        var workspaceId = tenant.RequireWorkspaceId();
        var existing = await tokens.ListAsync(workspaceId, ct);

        // ─────────────────────────────────────────────────────────────────
        //  เพดานจำนวนใบที่ยังใช้ได้
        //
        //  ไม่ใช่เรื่องพื้นที่เก็บ แต่เป็นเรื่องที่ว่า "รายการที่ยาวเกินไปคือรายการ
        //  ที่ไม่มีใครอ่าน" — ถ้ามีใบค้างอยู่ 200 ใบ คนจะไม่มีทางรู้ว่าใบไหนควร
        //  เพิกถอน ซึ่งทำให้ปุ่มเพิกถอนไร้ความหมาย
        // ─────────────────────────────────────────────────────────────────
        var now = DateTimeOffset.UtcNow;
        var active = existing.Count(t => t.IsActive(now));

        if (active >= MaxActiveTokens)
        {
            return Error.Conflict(
                $"มี token ที่ใช้งานได้ {active} ใบแล้ว — เพิกถอนใบที่ไม่ใช้ก่อน",
                "too_many_tokens");
        }

        var agent = await EnsureAgentAsync(workspaceId, ct);
        if (agent.IsFailure) return agent.Error;

        var pair = tokenService.CreateApiToken();

        var token = await tokens.AddAsync(new ApiToken
        {
            Id = Guid.CreateVersion7(),
            WorkspaceId = workspaceId,
            UserId = agent.Value.Id,
            Name = name,
            TokenHash = pair.TokenHash,
            Last4 = pair.Last4,
            CreatedBy = tenant.RequireUserId(),
            CreatedAt = now,
            ExpiresAt = request.ExpiresInDays is { } d ? now.AddDays(d) : null
        }, ct);

        logger.LogInformation(
            "ออก API token {TokenId} ({Name}) ให้ workspace {WorkspaceId} โดย {ActorId}",
            token.Id, name, workspaceId, tenant.RequireUserId());

        // ค่าจริงออกจากระบบที่นี่ที่เดียว — หลังจากนี้เหลือแค่ hash ในฐาน
        return new CreatedApiTokenDto(
            token.Id, token.Name, pair.Token, token.Last4, token.CreatedAt, token.ExpiresAt);
    }

    public async Task<Result<IReadOnlyList<ApiTokenDto>>> ListAsync(CancellationToken ct = default)
    {
        if (!RequireRole().IsWorkspaceWideEditor())
            return Error.Forbidden("ต้องเป็น owner หรือ admin เท่านั้น", "insufficient_role");

        var rows = await tokens.ListAsync(tenant.RequireWorkspaceId(), ct);
        var now = DateTimeOffset.UtcNow;

        return Result<IReadOnlyList<ApiTokenDto>>.Success(
        [
            .. rows.Select(t => new ApiTokenDto(
                t.Id, t.Name, t.Last4, DescribeStatus(t, now),
                t.CreatedAt, t.ExpiresAt, t.LastUsedAt))
        ]);
    }

    public async Task<Result> RevokeAsync(Guid tokenId, CancellationToken ct = default)
    {
        if (!RequireRole().IsWorkspaceWideEditor())
            return Error.Forbidden("ต้องเป็น owner หรือ admin เท่านั้น", "insufficient_role");

        var revoked = await tokens.RevokeAsync(tenant.RequireWorkspaceId(), tokenId, ct);

        if (!revoked)
            return Error.NotFound("ไม่พบ token ใบนี้ หรือถูกเพิกถอนไปแล้ว", "token_not_found");

        logger.LogInformation(
            "เพิกถอน API token {TokenId} โดย {ActorId}", tokenId, tenant.RequireUserId());

        return Result.Success();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  บัญชี agent — สร้างให้เองถ้ายังไม่มี
    //
    //  ⚠️ รหัสผ่านของบัญชีนี้เป็นค่าสุ่มที่ "ไม่มีใครได้เห็น" และไม่มีที่ไหนเก็บไว้
    //     ตั้งใจ: บัญชีนี้ไม่ได้มีไว้ให้คน login ทางเว็บ มันมีไว้เพื่อเป็นเจ้าของ
    //     การกระทำที่ AI ทำ (activity_log, last_edited_by) เท่านั้น
    //     ทางเข้าเดียวของมันคือ API token ซึ่งเพิกถอนได้รายใบ
    // ═══════════════════════════════════════════════════════════════════════
    private async Task<Result<User>> EnsureAgentAsync(Guid workspaceId, CancellationToken ct)
    {
        var existing = await tokens.FindAgentAsync(workspaceId, ct);
        if (existing is not null) return existing;

        var workspace = await workspaces.GetCurrentAsync(ct);
        if (workspace is null) return Error.NotFound("ไม่พบ workspace", "workspace_not_found");

        // อีเมลผูกกับ slug เพื่อให้แต่ละ workspace มีบัญชี AI ของตัวเองแยกกัน
        var email = $"claude+{workspace.Slug}@{workspace.Slug}.local";

        if (await users.EmailExistsAsync(email, ct))
        {
            // มีบัญชีอีเมลนี้อยู่แล้วแต่ไม่ได้เป็นสมาชิก/ไม่ได้เป็น agent ของ workspace นี้
            // — เกิดได้ถ้าเคยตั้งค่าแล้วถอดออกไป บอกให้ชัดดีกว่าสร้างซ้ำแล้วชนกัน
            return Error.Conflict(
                $"มีบัญชี {email} อยู่แล้วแต่ไม่ได้เป็นสมาชิกของ workspace นี้ — " +
                "เชิญเข้ามาเป็น member แล้วตั้งประเภทเป็น agent ก่อน",
                "agent_account_conflict");
        }

        var agent = await users.AddAsync(new User
        {
            Email = email,
            // 256 บิตจาก CSPRNG แล้วทิ้ง — ไม่มีใครต้องรู้ค่านี้
            PasswordHash = hasher.Hash(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))),
            Name = "Claude (AI)",
            Kind = UserKind.Agent,
            Locale = "th"
        }, ct);

        await workspaces.AddMemberAsync(new WorkspaceMember
        {
            WorkspaceId = workspaceId,
            UserId = agent.Id,
            // ⚠️ member ไม่ใช่ guest — guest สร้างหน้าระดับบนสุดไม่ได้ แล้ว AI
            //    จะเจอ Forbidden ซ้ำ ๆ ไม่จบ (ดู PageTreeService.CreateAsync)
            Role = WorkspaceRole.Member
        }, ct);

        logger.LogInformation(
            "สร้างบัญชี agent {UserId} ให้ workspace {WorkspaceId}", agent.Id, workspaceId);

        return agent;
    }

    private static string DescribeStatus(ApiToken token, DateTimeOffset now)
    {
        if (token.RevokedAt is not null) return "revoked";
        if (token.ExpiresAt is not null && token.ExpiresAt <= now) return "expired";
        return "active";
    }

    private WorkspaceRole RequireRole() =>
        tenant.WorkspaceRole ?? throw new InvalidOperationException("ไม่มี workspace context");
}
