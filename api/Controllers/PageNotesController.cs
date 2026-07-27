using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Filters;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Controllers;

// ═══════════════════════════════════════════════════════════════════════════
//  บันทึกบนหน้า (append-only)
//
//  มีอยู่เพื่อให้ AI เขียนข้อความเป็นภาษาคนได้โดยไม่ต้องแตะ Yjs
//
//  เนื้อหาหน้าเป็น CRDT ที่เซิร์ฟเวอร์เขียนไม่ได้อย่างปลอดภัย (โครงผิดนิดเดียว
//  y-prosemirror ลบ element แล้วกระจายการลบไปทุก client) ช่องนี้จึงให้ AI รายงาน
//  ความคืบหน้าหรือตั้งคำถามได้ ด้วยความเสี่ยงต่อข้อมูลเป็นศูนย์ และเจ้าของอ่าน
//  แยกจากเอกสารของตัวเองได้ชัดเจน
//
//  ⚠️ เขียนได้ด้วยสิทธิ์ "แสดงความเห็น" (commenter) ไม่ต้องถึงขั้นแก้เอกสารได้
//     ทำให้จำกัดขอบเขต AI ได้: ให้รายงานได้แต่ห้ามแก้เนื้อหา
// ═══════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/v1/pages/{pageId:guid}/notes")]
[Authorize]
[RequireWorkspace]
public class PageNotesController(ICollaborationService collaboration) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> List(Guid pageId, CancellationToken ct)
        => (await collaboration.ListNotesAsync(pageId, ct)).ToActionResult();

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> Add(
        Guid pageId, AddNoteRequest request, CancellationToken ct)
        => (await collaboration.AddNoteAsync(pageId, request, ct)).ToActionResult();
}
