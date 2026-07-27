using System.Text.Json;

namespace ProjectManagementAPI.DTOs;

// ═══════════════════════════════════════════════════════════════════════════
//  บันทึกบนหน้า + ฟีดกิจกรรม
// ═══════════════════════════════════════════════════════════════════════════

public record AddNoteRequest(string Body);

/// <param name="AuthorKind">"human" / "agent" — ให้เจ้าของรู้ว่า AI เขียนหรือคนเขียน</param>
public record NoteDto(
    Guid Id,
    Guid PageId,
    Guid? AuthorUserId,
    string? AuthorName,
    string? AuthorKind,
    string Body,
    DateTimeOffset CreatedAt);

/// <param name="PageId">
/// null = หน้านั้นถูกลบถาวรไปแล้ว — ใช้ PageTitle ที่เก็บสำเนาไว้แสดงแทน
/// </param>
/// <param name="Action">ดู Domain/ActivityAction — client ไม่ควร assume ว่ารู้จักครบ</param>
/// <param name="Detail">
/// รายละเอียดเป็น JSON object มี "v" บอกเวอร์ชันของ schema เสมอ
/// และมี from/to สำหรับเหตุการณ์ที่เป็นการเปลี่ยนค่า
/// </param>
public record ActivityDto(
    long Id,
    Guid? PageId,
    string PageTitle,
    Guid? ActorUserId,
    string? ActorName,
    string? ActorKind,
    string Action,
    JsonDocument? Detail,
    DateTimeOffset CreatedAt);

/// <param name="Truncated">true = ถูกตัดที่ limit อาจมีมากกว่านี้</param>
public record ActivityFeedDto(
    int Count,
    bool Truncated,
    IReadOnlyList<ActivityDto> Items);
