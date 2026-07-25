using System.Security.Claims;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Helpers;

namespace ProjectManagementAPI.Middlewares;

// ═══════════════════════════════════════════════════════════════════════════
//  TenantResolutionMiddleware
//
//  หา userId จาก claim และ workspace จาก header X-Workspace-Id แล้วตรวจ
//  สมาชิกภาพ ก่อนจะใส่ลง ITenantContext ซึ่ง AppDbContext อ่านไปใช้ใน
//  global query filter
//
//  ⚠️ ต้องอยู่ "หลัง" UseAuthentication ไม่งั้น HttpContext.User ยังว่าง
//
//  ⚠️ ตรวจสมาชิกภาพทุก request โดยเจตนา ไม่ได้เชื่อค่าที่ client ส่งมา
//     header บอกแค่ว่า "อยากทำงานใน workspace ไหน" ไม่ใช่ "มีสิทธิ์แล้ว"
//     ราคาคือ query 1 ครั้งต่อ request ซึ่งแลกกับการที่การถอดสมาชิกมีผลทันที
// ═══════════════════════════════════════════════════════════════════════════
public class TenantResolutionMiddleware(RequestDelegate next, ILogger<TenantResolutionMiddleware> logger)
{
    public const string WorkspaceHeader = "X-Workspace-Id";

    public async Task InvokeAsync(
        HttpContext context,
        ITenantContextSetter tenant,
        IIdentityQueries identity)
    {
        var userId = ReadUserId(context.User);

        if (userId is null)
        {
            // ยังไม่ได้ login — ปล่อยผ่าน endpoint ที่ไม่ต้องใช้ auth จัดการเอง
            await next(context);
            return;
        }

        tenant.SetUser(userId.Value);

        if (!context.Request.Headers.TryGetValue(WorkspaceHeader, out var rawHeader))
        {
            // request ที่ไม่ผูก workspace (login, /me, list workspaces) — ปกติ
            await next(context);
            return;
        }

        if (!Guid.TryParse(rawHeader.ToString(), out var workspaceId))
        {
            await WriteErrorAsync(context, StatusCodes.Status400BadRequest,
                $"{WorkspaceHeader} ต้องเป็น UUID", "invalid_workspace_header");
            return;
        }

        var role = await identity.ResolveMembershipAsync(
            userId.Value, workspaceId, context.RequestAborted);

        if (role is null)
        {
            // ─────────────────────────────────────────────────────────────
            //  404 ไม่ใช่ 403 โดยเจตนา
            //
            //  403 แปลว่า "workspace นี้มีอยู่จริงแต่คุณไม่มีสิทธิ์" ซึ่งทำให้
            //  คนนอกเดาได้ว่า workspace id ไหนมีอยู่จริง — เป็นการรั่วข้อมูล
            //  ข้าม tenant แม้จะเล็กน้อย
            // ─────────────────────────────────────────────────────────────
            logger.LogWarning(
                "user {UserId} พยายามเข้า workspace {WorkspaceId} ที่ไม่ได้เป็นสมาชิก",
                userId, workspaceId);

            await WriteErrorAsync(context, StatusCodes.Status404NotFound,
                "ไม่พบ workspace", "workspace_not_found");
            return;
        }

        tenant.SetWorkspace(workspaceId, role.Value);

        await next(context);
    }

    /// <summary>
    /// อ่าน sub จาก claim
    /// ใช้ชื่อสั้นได้เพราะ AuthConfiguration ตั้ง MapInboundClaims = false
    /// </summary>
    private static Guid? ReadUserId(ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue("sub");
        return Guid.TryParse(value, out var id) ? id : null;
    }

    private static Task WriteErrorAsync(
        HttpContext context, int statusCode, string message, string code)
    {
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";
        return context.Response.WriteAsJsonAsync(ApiResponse<object>.Fail(message, code));
    }
}
