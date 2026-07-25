using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Filters;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Controllers;

// ═══════════════════════════════════════════════════════════════════════════
//  Pages
//
//  ทุก endpoint ผูกกับ workspace — [RequireWorkspace] อยู่ที่ระดับคลาส
// ═══════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/v1/pages")]
[Authorize]
[RequireWorkspace]
public class PagesController(IPageTreeService tree) : ControllerBase
{
    /// <summary>ทั้ง tree สำหรับ sidebar (กรองตามสิทธิ์แล้ว)</summary>
    [HttpGet]
    public async Task<IActionResult> GetTree(CancellationToken ct)
        => (await tree.GetTreeAsync(ct)).ToActionResult();

    [HttpGet("{pageId:guid}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(Guid pageId, CancellationToken ct)
        => (await tree.GetAsync(pageId, ct)).ToActionResult();

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    public async Task<IActionResult> Create(CreatePageRequest request, CancellationToken ct)
    {
        var result = await tree.CreateAsync(request, ct);

        return result.IsSuccess
            ? result.ToCreatedResult($"/api/v1/pages/{result.Value.Id}")
            : result.ToActionResult();
    }

    [HttpPatch("{pageId:guid}")]
    public async Task<IActionResult> Update(
        Guid pageId, UpdatePageRequest request, CancellationToken ct)
        => (await tree.UpdateAsync(pageId, request, ct)).ToActionResult();

    /// <summary>ย้ายหน้าพร้อมลูกหลานทั้งหมด</summary>
    [HttpPost("{pageId:guid}/move")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Move(
        Guid pageId, MovePageRequest request, CancellationToken ct)
        => (await tree.MoveAsync(pageId, request, ct)).ToActionResult();

    /// <summary>ย้ายไปถังขยะ (soft delete) พร้อมลูกหลาน</summary>
    [HttpDelete("{pageId:guid}")]
    public async Task<IActionResult> Delete(Guid pageId, CancellationToken ct)
        => (await tree.DeleteAsync(pageId, ct)).ToActionResult();

    [HttpPost("{pageId:guid}/restore")]
    public async Task<IActionResult> Restore(Guid pageId, CancellationToken ct)
        => (await tree.RestoreAsync(pageId, ct)).ToActionResult();

    /// <summary>ลบถาวร — owner/admin เท่านั้น ย้อนกลับไม่ได้</summary>
    [HttpDelete("{pageId:guid}/purge")]
    public async Task<IActionResult> Purge(Guid pageId, CancellationToken ct)
        => (await tree.PurgeAsync(pageId, ct)).ToActionResult();

    [HttpGet("trash")]
    public async Task<IActionResult> GetTrash(CancellationToken ct)
        => (await tree.GetTrashAsync(ct)).ToActionResult();

    // ═══════════════════════════════════════════════════════════════════════
    //  Maintenance
    //
    //  ancestor_ids และ access_root_id เป็นค่า denormalise ที่เพี้ยนได้
    //  endpoint สองตัวนี้มีไว้ตรวจและซ่อม ควรตั้ง cron เรียก /consistency
    //  ทุกวันในช่วงเดือนแรก ๆ แล้ว alert เมื่อไม่เป็นศูนย์
    // ═══════════════════════════════════════════════════════════════════════

    [HttpGet("maintenance/consistency")]
    public async Task<IActionResult> CheckConsistency(CancellationToken ct)
        => (await tree.CheckConsistencyAsync(ct)).ToActionResult();

    [HttpPost("maintenance/repair")]
    public async Task<IActionResult> Repair(CancellationToken ct)
        => (await tree.RepairAsync(ct)).ToActionResult();
}
