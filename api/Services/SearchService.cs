using ProjectManagementAPI.Domain;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Repositories.Abstractions;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  SearchService
//
//  กรองสิทธิ์ด้วย "access root ที่มองเห็นได้" ในคิวรีเดียว ไม่ใช่กรองผลลัพธ์ทีหลัง
//  — การกรองทีหลังทำให้ LIMIT ผิด (ตัดก่อนกรอง แล้วได้ผลน้อยกว่าที่ควร) และ
//  ทำให้จำนวนผลที่บอกผู้ใช้ไม่ตรงกับที่เห็น
// ═══════════════════════════════════════════════════════════════════════════
public class SearchService(
    ISearchRepository search,
    IPermissionService permissions,
    ILogger<SearchService> logger) : ISearchService
{
    private const int DefaultLimit = 20;
    private const int MaxLimit = 50;

    /// <summary>คำค้นสั้นกว่านี้กับ bigram index จะกวาดเกือบทุกแถว</summary>
    private const int MinQueryLength = 2;

    public async Task<Result<SearchResultDto>> SearchAsync(
        string query, string? status, int? limit, CancellationToken ct = default)
    {
        var trimmed = (query ?? string.Empty).Trim();

        // ─────────────────────────────────────────────────────────────────
        //  คำค้นสั้นเกินไป — ปฏิเสธ ไม่ใช่คืนทุกอย่าง
        //
        //  index เป็น bigram (n=2) คำเดียวตัวอักษรเดียวจึงตรงกับแทบทุกแถว
        //  ซึ่งทั้งช้าและไม่มีประโยชน์ต่อผู้ค้น
        // ─────────────────────────────────────────────────────────────────
        if (trimmed.Length < MinQueryLength)
        {
            return Error.Validation(
                $"คำค้นต้องยาวอย่างน้อย {MinQueryLength} ตัวอักษร", "query_too_short");
        }

        var statuses = Array.Empty<string>();

        if (!string.IsNullOrWhiteSpace(status))
        {
            var normalised = status.Trim().ToLowerInvariant();

            if (!PageStatus.IsValid(normalised))
            {
                return Error.Validation(
                    $"สถานะต้องเป็นหนึ่งใน: {PageStatus.Listed}", "invalid_status");
            }

            statuses = [normalised];
        }

        var roots = await permissions.GetVisibleAccessRootsAsync(ct);

        // ไม่มี access root ที่เห็นได้เลย = ไม่มีอะไรให้ค้น ไม่ต้องยิงคิวรี
        // (`= ANY('{}')` เป็น false เสมออยู่แล้ว แต่การไม่ยิงเลยชัดเจนกว่า)
        if (roots.Count == 0)
        {
            return new SearchResultDto(trimmed, 0, Truncated: false, Hits: []);
        }

        // ขอเกินมาหนึ่งแถวเพื่อรู้ว่ามีมากกว่า limit จริงไหม โดยไม่ต้อง COUNT(*)
        // ซ้ำอีกรอบ — COUNT บน PGroonga ที่มีสิทธิ์กรองอยู่ด้วยแพงกว่าที่คุ้ม
        var effectiveLimit = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);
        var hits = await search.SearchAsync(trimmed, roots, statuses, effectiveLimit + 1, ct);

        var truncated = hits.Count > effectiveLimit;
        if (truncated) hits.RemoveAt(hits.Count - 1);

        logger.LogInformation(
            "ค้นหา {Query} — เจอ {Count} หน้า (ตัดที่ {Limit}: {Truncated})",
            trimmed, hits.Count, effectiveLimit, truncated);

        return new SearchResultDto(
            trimmed,
            hits.Count,
            truncated,
            [.. hits.Select(h => new SearchHitDto(
                h.Id, h.ParentId, h.Title, h.Icon, h.Status, h.Snippet, h.Score, h.UpdatedAt))]);
    }
}
