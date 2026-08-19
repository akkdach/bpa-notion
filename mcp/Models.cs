using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ProjectManagementMcp;

// ═══════════════════════════════════════════════════════════════════════════
//  DTO สำหรับ deserialize response ของ API (camelCase, case-insensitive)
//  ตรงกับ api/Helpers/ApiResponse.cs และ api/DTOs/*
// ═══════════════════════════════════════════════════════════════════════════

/// <summary>
/// รับ timestamp ได้ทั้ง ISO 8601 และรูปแบบ postgres ที่ API รุ่น NestJS ส่งมา
/// </summary>
/// <remarks>
/// ⚠️ NestJS + Drizzle ส่ง timestamptz เป็น "2026-08-19 06:35:00.839796+00"
///    (ช่องว่างคั่น ไม่มีตัว T) ซึ่ง System.Text.Json ไม่รับ — deserialize ทั้ง
///    envelope จะพังเงียบ ๆ แล้วกลายเป็น "API 200: OK (no_code)" ทุก tool ที่
///    model มี field วันที่ ส่วน API รุ่น .NET เดิมส่ง ISO ตรง ๆ จึงต้องรับทั้งคู่
/// </remarks>
internal sealed class FlexibleDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(
        ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TryGetDateTimeOffset(out var iso)) return iso;

        return DateTimeOffset.Parse(
            reader.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
    }

    public override void Write(
        Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
        => writer.WriteStringValue(value);
}

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

/// <summary>ผลการเขียนเนื้อหา — ผลของ POST /api/v1/pages/{id}/content/markdown</summary>
/// <param name="Warnings">
/// สิ่งที่ถูกลดรูป (ตาราง รูป HTML การซ้อนที่ลึกเกิน) — ต้องส่งต่อให้โมเดลเห็นเสมอ
/// ไม่ใช่กลืนไว้ ไม่งั้นมันจะเชื่อว่าเขียนของที่ระบบรับไม่ได้ลงไปสำเร็จแล้ว
/// </param>
// ⚠️ NestJS ส่ง field ชื่อ "blocks" (รุ่น .NET เดิมส่ง "blockCount") — ไม่ map ชื่อ
//    จะได้ 0 เงียบ ๆ ทุกครั้งแล้วรายงานผู้ใช้ผิด
public sealed record AppendResult(
    long Seq,
    [property: JsonPropertyName("blocks")] int BlockCount,
    IReadOnlyList<string> Warnings);

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
