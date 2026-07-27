using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;

namespace ProjectManagementAPI.Services.Abstractions;

public interface ICollaborationService
{
    /// <summary>
    /// เขียนบันทึกต่อท้ายหน้า — ต้องมีสิทธิ์ "แสดงความเห็น" ขึ้นไป (ไม่ต้องแก้ได้)
    /// </summary>
    Task<Result<NoteDto>> AddNoteAsync(
        Guid pageId, AddNoteRequest request, CancellationToken ct = default);

    /// <summary>บันทึกของหน้าหนึ่ง เรียงเก่าไปใหม่ — ต้องมีสิทธิ์เห็นหน้านั้น</summary>
    Task<Result<IReadOnlyList<NoteDto>>> ListNotesAsync(
        Guid pageId, CancellationToken ct = default);

    /// <summary>
    /// ฟีดกิจกรรมของ workspace หรือของหน้าเดียว — กรองตามสิทธิ์แล้ว
    /// </summary>
    /// <param name="pageId">ระบุ = ประวัติของหน้านั้นเท่านั้น</param>
    /// <param name="actorKind">"human" / "agent" — กรองว่าใครทำ</param>
    Task<Result<ActivityFeedDto>> GetActivityAsync(
        Guid? pageId, string? actorKind, DateTimeOffset? since, int? limit,
        CancellationToken ct = default);
}
