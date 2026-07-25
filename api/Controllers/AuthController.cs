using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Controllers;

// ═══════════════════════════════════════════════════════════════════════════
//  Auth
//
//  controller บาง: bind → เรียก service → map Result เป็น HTTP
//  ไม่มี AppDbContext ไม่มี business logic ไม่มี try/catch (มี ApiExceptionFilter)
// ═══════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/v1/auth")]
public class AuthController(IAuthService auth) : ControllerBase
{
    [HttpPost("register")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Register(RegisterRequest request, CancellationToken ct)
        => (await auth.RegisterAsync(request, ReadClientInfo(), ct)).ToActionResult();

    [HttpPost("login")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Login(LoginRequest request, CancellationToken ct)
        => (await auth.LoginAsync(request, ReadClientInfo(), ct)).ToActionResult();

    [HttpPost("refresh")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Refresh(RefreshRequest request, CancellationToken ct)
        => (await auth.RefreshAsync(request.RefreshToken, ReadClientInfo(), ct)).ToActionResult();

    [HttpPost("logout")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> Logout(RefreshRequest request, CancellationToken ct)
        => (await auth.LogoutAsync(request.RefreshToken, ct)).ToActionResult();

    /// <summary>ข้อมูล user ปัจจุบัน + workspace ทั้งหมดที่เป็นสมาชิก</summary>
    [HttpGet("me")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var userId = this.GetUserId();
        if (userId is null)
        {
            return Unauthorized(ApiResponse<object>.Fail("token ไม่ถูกต้อง", "invalid_token"));
        }

        return (await auth.GetCurrentAsync(userId.Value, ct)).ToActionResult();
    }

    private ClientInfo ReadClientInfo() => new(
        Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null,
        HttpContext.Connection.RemoteIpAddress?.ToString());
}

// ═══════════════════════════════════════════════════════════════════════════
//  อ่าน userId จาก claim
//
//  ใช้ "sub" ตรง ๆ ได้เพราะ AuthConfiguration ตั้ง MapInboundClaims = false
//  ถ้าเปิด mapping ไว้ .NET จะเปลี่ยน sub เป็น URI ยาวของ WS-Federation แล้ว
//  บรรทัดนี้จะได้ null ทั้งที่ token มี sub อยู่
// ═══════════════════════════════════════════════════════════════════════════
public static class ControllerBaseExtensions
{
    public static Guid? GetUserId(this ControllerBase controller)
    {
        var value = controller.User.FindFirstValue("sub");
        return Guid.TryParse(value, out var id) ? id : null;
    }
}
