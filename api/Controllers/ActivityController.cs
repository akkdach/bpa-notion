using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProjectManagementAPI.Filters;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Controllers;

// ═══════════════════════════════════════════════════════════════════════════
//  Activity — ใครทำอะไรกับหน้าไหนเมื่อไหร่
//
//  มีอยู่เพื่อตอบคำถามที่ตอบไม่ได้เลยก่อนหน้านี้: "งานนี้ AI แก้หรือฉันแก้เอง"
//  ก่อนมี users.kind + ตารางนี้ ระบบมีแต่ pages.last_edited_by ซึ่งไม่อยู่ใน DTO
//  ใดเลย และเป็นค่าเดียวกันทั้งสองกรณีเพราะ MCP ใช้บัญชีเดียวกับเจ้าของ
// ═══════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/v1/activity")]
[Authorize]
[RequireWorkspace]
public class ActivityController(ICollaborationService collaboration) : ControllerBase
{
    /// <param name="pageId">ระบุ = ประวัติของหน้านั้นเท่านั้น</param>
    /// <param name="actorKind">กรองว่าใครทำ: human / agent</param>
    /// <param name="since">เอาเฉพาะที่เกิดหลังเวลานี้ — ใช้ทำ polling</param>
    /// <param name="limit">จำนวนรายการ (1-200, ค่าเริ่มต้น 50)</param>
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Get(
        [FromQuery] Guid? pageId,
        [FromQuery] string? actorKind,
        [FromQuery] DateTimeOffset? since,
        [FromQuery] int? limit,
        CancellationToken ct)
        => (await collaboration.GetActivityAsync(pageId, actorKind, since, limit, ct))
            .ToActionResult();
}
