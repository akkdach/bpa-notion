using System.Text.Json;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Repositories.Abstractions;

public interface IActivityRepository
{
    /// <summary>
    /// อ่านฟีดกิจกรรม เรียงใหม่สุดก่อน
    /// </summary>
    /// <param name="pageIds">
    /// จำกัดเฉพาะหน้าที่ผู้เรียกมีสิทธิ์เห็น — null = ไม่กรอง (ใช้กับ owner/admin
    /// ที่เห็นทุกหน้าอยู่แล้ว จึงไม่ต้องส่ง id เป็นพันตัวเข้ามา)
    ///
    /// ⚠️ แถวที่ page_id เป็น null (หน้าถูกลบถาวร) จะติดมาด้วยเสมอเมื่อกรอง
    ///    เพราะมันคือแถวที่ตอบคำถาม "ใครลบหน้านั้น" ซึ่งเป็นเหตุการณ์ที่ผู้เรียก
    ///    เห็นได้ตอนมันเกิด การซ่อนทีหลังเพราะหน้าไม่มีแล้วไม่ได้กันข้อมูลรั่วอะไร
    /// </param>
    Task<List<ActivityRow>> ListAsync(
        IReadOnlyList<Guid>? pageIds,
        Guid? pageId,
        DateTimeOffset? since,
        int limit,
        CancellationToken ct = default);

    /// <summary>
    /// เขียนแถวเดียว — ใช้เมื่อเหตุการณ์ไม่ได้อยู่ในธุรกรรมของการเปลี่ยนแปลงอื่น
    /// (เช่น การเขียนบันทึก ซึ่งตัวมันเองคือการเปลี่ยนแปลง)
    /// </summary>
    Task AddAsync(ActivityLog entry, CancellationToken ct = default);
}

/// <param name="ActorName">null เมื่อบัญชีถูกลบไปแล้ว</param>
/// <param name="ActorKind">
/// คนหรือ AI — ตัวที่ทำให้แยกงานของ AI ออกจากงานของคนได้
///
/// เป็น enum ไม่ใช่ string เพราะการเรียก .ToString() ในนิพจน์ LINQ แปลเป็น SQL
/// ไม่ได้ (คอลัมน์เก็บเป็น text ผ่าน ValueConverter อยู่แล้ว) แปลงเป็นสตริงที่ชั้น
/// service ด้วย ToDbValue()
/// </param>
/// <param name="Detail">
/// jsonb ดิบ — ปล่อยเป็น JsonDocument ให้ System.Text.Json เขียนออกเป็น object
/// ตรง ๆ ไม่ต้องแปลงเป็นสตริงแล้วถูก escape ซ้ำ
/// </param>
public record ActivityRow(
    long Id,
    Guid? PageId,
    string PageTitle,
    Guid? ActorUserId,
    string? ActorName,
    UserKind? ActorKind,
    string Action,
    JsonDocument? Detail,
    DateTimeOffset CreatedAt);
