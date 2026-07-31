using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Filters;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Controllers;

// ═══════════════════════════════════════════════════════════════════════════
//  API token — กุญแจให้เครื่องภายนอก (MCP server) เข้าถึง workspace นี้
//
//  แทนที่การให้เครื่องภายนอกเก็บอีเมล/รหัสผ่านไว้แล้ว login เอง:
//  token ผูกกับ workspace เดียว เพิกถอนรายใบได้ และรู้ว่าใช้ครั้งสุดท้ายเมื่อไหร่
//
//  ⚠️ ค่าจริงของ token แสดง "ครั้งเดียว" ตอนสร้าง ฐานข้อมูลเก็บแค่ SHA-256
//     ทำหายแล้วต้องออกใบใหม่ ไม่มี endpoint ขอดูอีกครั้งโดยเจตนา
// ═══════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/v1/workspaces/current/tokens")]
[Authorize]
[RequireWorkspace]
public class ApiTokensController(IApiTokenService tokens) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> List(CancellationToken ct)
        => (await tokens.ListAsync(ct)).ToActionResult();

    /// <summary>ออก token ใหม่ — ค่าจริงอยู่ใน response นี้ครั้งเดียวเท่านั้น</summary>
    [HttpPost]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> Create(CreateApiTokenRequest request, CancellationToken ct)
        => (await tokens.CreateAsync(request, ct)).ToActionResult();

    [HttpDelete("{tokenId:guid}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Revoke(Guid tokenId, CancellationToken ct)
        => (await tokens.RevokeAsync(tokenId, ct)).ToActionResult();
}
