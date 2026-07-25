using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Filters;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Controllers;

// ═══════════════════════════════════════════════════════════════════════════
//  Workspaces
//
//  endpoint แบ่งเป็นสองกลุ่ม:
//    · ไม่ผูก workspace  — สร้างใหม่, ดูรายการของตัวเอง (ข้าม tenant โดยเจตนา)
//    · ผูก workspace     — มี [RequireWorkspace] ต้องส่ง header X-Workspace-Id
// ═══════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/v1/workspaces")]
[Authorize]
public class WorkspacesController(IWorkspaceService workspaces) : ControllerBase
{
    // ─────────────────────────────────────────────────────────────────────
    //  ไม่ผูก workspace
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>workspace ทั้งหมดที่ user เป็นสมาชิก</summary>
    [HttpGet]
    public async Task<IActionResult> ListMine(CancellationToken ct)
    {
        var userId = this.GetUserId();
        if (userId is null) return UnauthorizedResponse();

        return (await workspaces.ListMineAsync(userId.Value, ct)).ToActionResult();
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Create(CreateWorkspaceRequest request, CancellationToken ct)
    {
        var userId = this.GetUserId();
        if (userId is null) return UnauthorizedResponse();

        var result = await workspaces.CreateAsync(request, userId.Value, ct);

        return result.IsSuccess
            ? result.ToCreatedResult($"/api/v1/workspaces/{result.Value.Id}")
            : result.ToActionResult();
    }

    // ─────────────────────────────────────────────────────────────────────
    //  ผูก workspace — ต้องมี header X-Workspace-Id
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>รายละเอียดของ workspace ปัจจุบัน</summary>
    [HttpGet("current")]
    [RequireWorkspace]
    public async Task<IActionResult> GetCurrent(CancellationToken ct)
        => (await workspaces.GetCurrentAsync(ct)).ToActionResult();

    [HttpPatch("current")]
    [RequireWorkspace]
    public async Task<IActionResult> Update(UpdateWorkspaceRequest request, CancellationToken ct)
        => (await workspaces.UpdateAsync(request, ct)).ToActionResult();

    [HttpGet("current/members")]
    [RequireWorkspace]
    public async Task<IActionResult> ListMembers(CancellationToken ct)
        => (await workspaces.ListMembersAsync(ct)).ToActionResult();

    /// <summary>เพิ่มสมาชิกด้วยอีเมลของ user ที่สมัครไว้แล้ว (ไม่มีการเชิญทางอีเมล)</summary>
    [HttpPost("current/members")]
    [RequireWorkspace]
    public async Task<IActionResult> AddMember(AddMemberRequest request, CancellationToken ct)
        => (await workspaces.AddMemberAsync(request, ct)).ToActionResult();

    [HttpPatch("current/members/{userId:guid}")]
    [RequireWorkspace]
    public async Task<IActionResult> UpdateMemberRole(
        Guid userId, UpdateMemberRoleRequest request, CancellationToken ct)
        => (await workspaces.UpdateMemberRoleAsync(userId, request, ct)).ToActionResult();

    [HttpDelete("current/members/{userId:guid}")]
    [RequireWorkspace]
    public async Task<IActionResult> RemoveMember(Guid userId, CancellationToken ct)
        => (await workspaces.RemoveMemberAsync(userId, ct)).ToActionResult();

    private IActionResult UnauthorizedResponse()
        => Unauthorized(ApiResponse<object>.Fail("token ไม่ถูกต้อง", "invalid_token"));
}
