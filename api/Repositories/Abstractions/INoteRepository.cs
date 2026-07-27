using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Repositories.Abstractions;

public interface INoteRepository
{
    /// <summary>
    /// เขียนบันทึกพร้อมแถว activity ในธุรกรรมเดียว
    /// </summary>
    /// <remarks>
    /// รวมสองอย่างเข้าเป็น method เดียวเพราะ "การเขียนบันทึก" กับ "ประวัติว่ามีคนเขียน
    /// บันทึก" ต้องเกิดหรือไม่เกิดพร้อมกัน ถ้าแยกกันแล้วอย่างหนึ่งล้ม ฟีดกิจกรรมจะ
    /// ไม่ตรงกับสิ่งที่อยู่ในหน้า
    /// </remarks>
    Task<PageNote> AddAsync(PageNote note, ActivityLog activity, CancellationToken ct = default);

    /// <summary>บันทึกของหน้าหนึ่ง เรียงเก่าไปใหม่ (อ่านเป็นลำดับเวลาเหมือนบทสนทนา)</summary>
    Task<List<NoteRow>> ListAsync(Guid pageId, int limit, CancellationToken ct = default);
}

/// <param name="AuthorKind">คนหรือ AI — ให้เจ้าของรู้ว่าบันทึกนี้ AI เขียนหรือคนเขียน</param>
public record NoteRow(
    Guid Id,
    Guid PageId,
    Guid? AuthorUserId,
    string? AuthorName,
    UserKind? AuthorKind,
    string Body,
    DateTimeOffset CreatedAt);
