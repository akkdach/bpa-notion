using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProjectManagementAPI.Filters;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Controllers;

// ═══════════════════════════════════════════════════════════════════════════
//  Search — ค้นหาข้อความไทยด้วย PGroonga
//
//  ค้นบน page_searches ซึ่งเป็น projection ที่เบราว์เซอร์ส่งกลับมา ไม่ใช่ตัว
//  เอกสารจริง (เอกสารจริงเป็น Yjs CRDT ที่เซิร์ฟเวอร์ไม่แกะ) หน้าที่ยังไม่มีใคร
//  เปิดจะมีแต่ชื่อให้ค้น เนื้อหายังว่าง — ดู ContentFreshness
// ═══════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/v1/search")]
[Authorize]
[RequireWorkspace]
public class SearchController(ISearchService search) : ControllerBase
{
    /// <param name="q">คำค้น — อักขระพิเศษถูก escape ให้ ไม่ต้องระวังเอง</param>
    /// <param name="status">กรองสถานะงาน: todo / doing / done</param>
    /// <param name="limit">จำนวนผลลัพธ์ (1-50, ค่าเริ่มต้น 20)</param>
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Search(
        [FromQuery] string q,
        [FromQuery] string? status,
        [FromQuery] int? limit,
        CancellationToken ct)
        => (await search.SearchAsync(q, status, limit, ct)).ToActionResult();
}
