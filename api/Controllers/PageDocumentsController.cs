using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Filters;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Controllers;

// ═══════════════════════════════════════════════════════════════════════════
//  เนื้อหาของหน้า (Yjs)
//
//  ⚠️ bootstrap อยู่บน REST ไม่ใช่ SignalR โดยเจตนา
//     SignalR จำกัดข้อความไว้ 32KB โดย default และ full state ของเอกสารที่ใช้
//     งานจริงใหญ่กว่านั้นได้ง่าย ๆ การใช้ REST ทำให้ไม่ต้องไปสู้กับลิมิตนั้น
//     และได้ HTTP caching/compression มาฟรี ๆ
// ═══════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/v1/pages/{pageId:guid}")]
[Authorize]
[RequireWorkspace]
public class PageDocumentsController(IDocumentService documents) : ControllerBase
{
    /// <summary>ขนาดสูงสุดของ body ที่รับ — ตรงกับ MaximumReceiveMessageSize ของ SignalR</summary>
    private const int MaxBodyBytes = 4 * 1024 * 1024;

    /// <summary>
    /// ทุกอย่างที่ต้องใช้ประกอบเอกสาร: snapshot + update ที่เกิดหลังจากนั้น
    ///
    /// ตอบเป็น application/octet-stream รูปแบบ [u32 count][u32 len][bytes]…
    /// frame 0 คือ snapshot (ยาว 0 ถ้ายังไม่เคย compact)
    ///
    /// metadata ไปกับ response header เพื่อให้ body เป็นไบนารีล้วน
    /// </summary>
    // ⚠️ ห้ามใส่ [Produces("application/octet-stream")]
    //
    //    มันบังคับ content negotiation ทั้ง action ทำให้ตอนตอบ error เป็น JSON
    //    (404/403) ASP.NET Core ปฏิเสธด้วย 406 Not Acceptable แทน — client จะ
    //    ได้ status ที่ไม่มีความหมายและไม่มี body ให้อ่านเลย
    //    เส้นทางสำเร็จกำหนด content type เองผ่าน File() อยู่แล้ว
    [HttpGet("ydoc")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetDocument(Guid pageId, CancellationToken ct)
    {
        var result = await documents.GetBootstrapAsync(pageId, ct);
        if (result.IsFailure) return result.ToActionResult();

        var doc = result.Value;

        Response.Headers["X-Doc-Role"] = doc.Role;
        Response.Headers["X-Doc-Head-Seq"] = doc.HeadSeq.ToString();
        Response.Headers["X-Doc-Snapshot-Up-To"] = doc.SnapshotUpToSeq.ToString();
        Response.Headers["X-Doc-Updates-Since-Snapshot"] = doc.UpdatesSinceSnapshot.ToString();
        Response.Headers["X-Doc-Should-Compact"] = doc.ShouldCompact ? "1" : "0";

        // ห้าม cache — เนื้อหาเปลี่ยนตลอด และ header พวกนี้เป็น state ปัจจุบัน
        Response.Headers.CacheControl = "no-store";

        return File(doc.Frames, "application/octet-stream");
    }

    /// <summary>
    /// ส่ง Yjs update เข้ามาต่อท้าย log
    ///
    /// Phase 1 ใช้ทางนี้ Phase 2 ย้ายไป SignalR แล้วเหลือทางนี้ไว้เป็นทางสำรอง
    /// ตอน WebSocket ต่อไม่ได้
    /// </summary>
    [HttpPost("ydoc/update")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> AppendUpdate(
        Guid pageId, [FromQuery] long? yClientId, CancellationToken ct)
    {
        var body = await ReadBodyAsync(ct);
        if (body.IsFailure) return body.ToActionResult();

        return (await documents.AppendUpdateAsync(pageId, body.Value, yClientId, ct))
            .ToActionResult();
    }

    /// <summary>
    /// snapshot ที่ client สร้าง (Y.encodeStateAsUpdate) — ใช้ compact log
    /// ⚠️ เป็นจุดเดียวที่ client เขียนข้อมูลที่เซิร์ฟเวอร์ตรวจเนื้อหาไม่ได้
    /// </summary>
    [HttpPost("ydoc/snapshot")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> SaveSnapshot(
        Guid pageId, [FromQuery] long upToSeq, CancellationToken ct)
    {
        var body = await ReadBodyAsync(ct);
        if (body.IsFailure) return body.ToActionResult();

        return (await documents.SaveSnapshotAsync(pageId, body.Value, upToSeq, ct))
            .ToActionResult();
    }

    /// <summary>
    /// เนื้อหาหน้าเป็น plain text — ทางที่ไม่ใช่เบราว์เซอร์ (เช่น AI ผ่าน MCP) อ่านเนื้อหาได้
    /// </summary>
    /// <remarks>
    /// ⚠️ ไม่ใช่ตัวเอกสารจริง — เป็น projection ที่เบราว์เซอร์แกะจาก Y.Doc ส่งกลับมา
    ///    response มี freshness บอกว่าเชื่อได้แค่ไหน อย่าเดาจาก bodyText ว่างเปล่า
    ///    ว่าหน้านั้นว่าง (ดู ContentFreshness)
    /// </remarks>
    [HttpGet("content")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetContent(Guid pageId, CancellationToken ct)
        => (await documents.GetContentAsync(pageId, ct)).ToActionResult();

    /// <summary>
    /// ต่อท้ายย่อหน้าธรรมดาเข้าไปในเอกสาร — จุดเดียวที่เซิร์ฟเวอร์เขียน Yjs
    /// </summary>
    /// <remarks>
    /// ⚠️ ต่อท้ายเท่านั้น แก้หรือลบของเดิมไม่ได้ และรับเฉพาะย่อหน้าธรรมดา
    ///    (ไม่มี heading / list / table / mark) — ดูเหตุผลเต็มที่ BlockNoteWriter
    ///
    /// ⚠️ เป็น POST ไม่ใช่ PUT โดยเจตนา — PUT สื่อว่าเขียนทับทั้งทรัพยากร ซึ่งเป็น
    ///    สิ่งที่ endpoint นี้ตั้งใจ "ไม่" ทำ
    /// </remarks>
    [HttpPost("content/paragraphs")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> AppendParagraphs(
        Guid pageId, AppendParagraphsRequest request, CancellationToken ct)
        => (await documents.AppendParagraphsAsync(pageId, request.Paragraphs ?? [], ct))
            .ToActionResult();

    /// <summary>ต่อท้ายเนื้อหาที่เขียนเป็น markdown</summary>
    /// <remarks>
    /// รองรับหัวข้อ รายการ คำพูดอ้างอิง บล็อกโค้ด และเส้นคั่น
    /// ` ```mermaid ` จะแสดงเป็นแผนภาพจริงในเบราว์เซอร์
    ///
    /// ⚠️ ตาราง/รูป/HTML ถูกลดรูปเป็นบล็อกโค้ดแล้วรายงานกลับทาง warnings
    ///    ไม่ใช่ปฏิเสธทั้งคำขอ — ดูเหตุผลที่ IDocumentService
    ///
    /// ⚠️ ต่อท้ายเท่านั้น แก้หรือลบของเดิมไม่ได้
    /// </remarks>
    [HttpPost("content/markdown")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> AppendMarkdown(
        Guid pageId, AppendMarkdownRequest request, CancellationToken ct)
        => (await documents.AppendMarkdownAsync(pageId, request.Markdown ?? string.Empty, ct))
            .ToActionResult();

    /// <summary>
    /// plain text ที่ client แกะจาก Y.Doc — ใช้ทำ index ค้นหาและ title ใน sidebar
    /// client ควรส่งหลังผู้ใช้หยุดพิมพ์สักครู่ ไม่ใช่ทุก keystroke
    /// </summary>
    [HttpPost("projection")]
    public async Task<IActionResult> SaveProjection(
        Guid pageId, ProjectionRequest request, CancellationToken ct)
        => (await documents.SaveProjectionAsync(pageId, request, ct)).ToActionResult();

    /// <summary>หน้าที่ลิงก์มาหาหน้านี้ (แผง backlinks)</summary>
    [HttpGet("backlinks")]
    public async Task<IActionResult> GetBacklinks(Guid pageId, CancellationToken ct)
        => (await documents.GetBacklinksAsync(pageId, ct)).ToActionResult();

    // ─────────────────────────────────────────────────────────────────────
    //  อ่าน body แบบไบนารี
    //
    //  ใช้ [FromBody] ไม่ได้เพราะ body เป็นไบต์ดิบ ไม่ใช่ JSON
    //  จำกัดขนาดเองเพราะไม่มี model binder มาทำให้
    // ─────────────────────────────────────────────────────────────────────
    private async Task<Result<byte[]>> ReadBodyAsync(CancellationToken ct)
    {
        if (Request.ContentLength > MaxBodyBytes)
        {
            return Error.Validation(
                $"ข้อมูลใหญ่เกิน {MaxBodyBytes / 1024 / 1024} MB", "payload_too_large");
        }

        using var memory = new MemoryStream();
        await Request.Body.CopyToAsync(memory, ct);

        if (memory.Length > MaxBodyBytes)
        {
            return Error.Validation(
                $"ข้อมูลใหญ่เกิน {MaxBodyBytes / 1024 / 1024} MB", "payload_too_large");
        }

        if (memory.Length == 0)
        {
            return Error.Validation("ไม่มีข้อมูลใน body", "empty_body");
        }

        return memory.ToArray();
    }
}
