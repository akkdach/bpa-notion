using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using ProjectManagementAPI.Repositories.Abstractions;
using ProjectManagementAPI.Services;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Configurations;

// ═══════════════════════════════════════════════════════════════════════════
//  ยืนยันตัวตนด้วย API token (`Authorization: Bearer pmt_…`)
//
//  ใช้โดยเครื่องภายนอกอย่าง MCP server ที่ไม่ควรเก็บรหัสผ่านของใครไว้บนดิสก์
//
//  ⚠️ token พก "workspace" มาด้วยในตัว ต่างจาก JWT ที่ไม่มี
//     TenantResolutionMiddleware จึงต้องเคารพค่านี้และปฏิเสธเมื่อ header
//     X-Workspace-Id ชี้ไปคนละที่ — ไม่งั้นใบของ workspace A จะใช้กับ B ได้
//     เมื่อบัญชีบังเอิญเป็นสมาชิกทั้งคู่
//
//  ⚠️ ตรวจกับฐานข้อมูลทุก request โดยเจตนา ไม่ cache
//     เพราะ "เพิกถอนแล้วต้องมีผลทันที" เป็นคุณสมบัติหลักของ token — การ cache
//     5 วินาทีก็แปลว่ามีหน้าต่าง 5 วินาทีที่ใบที่ถูกเพิกถอนยังใช้ได้
//     ราคาที่จ่ายคือ index lookup หนึ่งครั้งต่อคำขอ ซึ่งถูกกว่าที่คิดมาก
// ═══════════════════════════════════════════════════════════════════════════
public class ApiTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IApiTokenRepository tokens,
    ITokenService tokenService)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "ApiToken";

    /// <summary>claim ที่บอกว่า token ใบนี้ผูกกับ workspace ไหน</summary>
    public const string WorkspaceClaim = "pm_workspace";

    /// <summary>claim ของ id ของใบ — ไว้ log และอัปเดต last_used</summary>
    public const string TokenIdClaim = "pm_token_id";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();

        if (string.IsNullOrEmpty(header) ||
            !header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.NoResult();
        }

        var raw = header["Bearer ".Length..].Trim();

        // ไม่ใช่ API token — ปล่อยให้ scheme อื่น (JWT) จัดการ
        if (!raw.StartsWith(TokenService.ApiTokenPrefix, StringComparison.Ordinal))
        {
            return AuthenticateResult.NoResult();
        }

        var principal = await tokens.ResolveAsync(tokenService.HashRefreshToken(raw));

        if (principal is null)
        {
            // ─────────────────────────────────────────────────────────────
            //  ข้อความเดียวสำหรับทุกสาเหตุ (ไม่มีใบนี้ / เพิกถอนแล้ว / หมดอายุ /
            //  ถูกถอดออกจาก workspace) — การบอกว่า "ใบนี้มีอยู่จริงแต่ถูกเพิกถอน"
            //  คือการยืนยันให้คนที่ได้ token ไปว่าเขาได้ของจริงมา
            // ─────────────────────────────────────────────────────────────
            Logger.LogWarning("ปฏิเสธ API token ที่ใช้ไม่ได้ (path {Path})", Request.Path);
            return AuthenticateResult.Fail("API token ใช้ไม่ได้");
        }

        // อัปเดตแบบ fire-and-forget ไม่ได้ — DbContext เป็น scoped ต่อ request
        // ถ้าปล่อยให้ทำงานหลัง response มันจะถูก dispose ไปแล้ว
        await tokens.TouchAsync(principal.TokenId);

        var identity = new ClaimsIdentity(
            [
                // "sub" ตรงกับที่ JWT ใช้ — โค้ดปลายทาง (GetUserId) จึงไม่ต้องรู้ว่า
                // request นี้มาด้วยวิธีไหน
                new Claim("sub", principal.UserId.ToString()),
                new Claim(WorkspaceClaim, principal.WorkspaceId.ToString()),
                new Claim(TokenIdClaim, principal.TokenId.ToString()),
            ],
            SchemeName);

        return AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }
}
