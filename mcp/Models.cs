namespace ProjectManagementMcp;

// ═══════════════════════════════════════════════════════════════════════════
//  DTO สำหรับ deserialize response ของ API (camelCase, case-insensitive)
//  ตรงกับ api/Helpers/ApiResponse.cs และ api/DTOs/*
// ═══════════════════════════════════════════════════════════════════════════

public sealed record Envelope<T>(bool Success, T? Data, string? Message, string? Code);

public sealed record WorkspaceSummary(Guid Id, string Slug, string Name, string? Icon, string Role);

/// <summary>โหนดใน tree (sidebar) — ผลของ GET /api/v1/pages</summary>
public sealed record PageNode(
    Guid Id,
    Guid? ParentId,
    string Title,
    string? Icon,
    string? Status,
    string Rank,
    int Depth,
    bool HasChildren,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? DeletedAt);

/// <summary>หน้าเดี่ยว — ผลของ GET/POST/PATCH /api/v1/pages/{id}</summary>
public sealed record PageDto(
    Guid Id,
    Guid? ParentId,
    string Title,
    string? Icon,
    string? CoverUrl,
    string? Status,
    string Kind,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// เนื้อหาหน้าเป็น plain text — ผลของ GET /api/v1/pages/{id}/content
/// </summary>
/// <param name="Freshness">
/// "never" = ยังไม่เคยมีเบราว์เซอร์เปิดหน้านี้ BodyText ว่างเพราะ "ไม่มีข้อมูล"
/// ไม่ใช่เพราะหน้าว่าง — ต้องรายงานให้ต่างกัน
///
/// "from_document" = เบราว์เซอร์แกะจากเอกสารจริงแล้วส่งมา
/// </param>
public sealed record PageContent(
    Guid Id,
    string Title,
    string BodyText,
    string Freshness,
    DateTimeOffset PageUpdatedAt,
    DateTimeOffset? ProjectionUpdatedAt);

/// <param name="AffectedDescendants">จำนวนลูกหลานที่ถูกอัปเดตไปพร้อมกัน</param>
public sealed record MoveResult(PageDto Page, int AffectedDescendants);

/// <summary>บันทึกบนหน้า — ผลของ GET/POST /api/v1/pages/{id}/notes</summary>
/// <param name="AuthorKind">"human" / "agent" — บอกว่าบันทึกนี้คนเขียนหรือ AI เขียน</param>
public sealed record PageNote(
    Guid Id,
    Guid PageId,
    Guid? AuthorUserId,
    string? AuthorName,
    string? AuthorKind,
    string Body,
    DateTimeOffset CreatedAt);

/// <summary>ผลการเขียนเนื้อหา — ผลของ POST /api/v1/pages/{id}/content/paragraphs</summary>
public sealed record AppendResult(long Seq, int ParagraphCount);

/// <summary>ผลค้นหา — ผลของ GET /api/v1/search</summary>
public sealed record SearchResult(
    string Query,
    int Count,
    bool Truncated,
    IReadOnlyList<SearchHit> Hits);

public sealed record SearchHit(
    Guid Id,
    Guid? ParentId,
    string Title,
    string? Icon,
    string? Status,
    string Snippet,
    double Score,
    DateTimeOffset UpdatedAt);
