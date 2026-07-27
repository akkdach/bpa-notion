using System.Text.Json;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  ตัวช่วยประกอบแถว activity_log
//
//  แยกออกมาเพื่อให้ทุกที่ที่เขียนประวัติผลิต detail รูปแบบเดียวกัน — ถ้าปล่อยให้
//  แต่ละ call site ประกอบ jsonb เอง ฟีดกิจกรรมจะต้องรู้จัก schema หลายแบบและ
//  ปุ่ม "ย้อนกลับ" จะอ่าน from/to ไม่ได้เมื่อบางแถวสะกดคีย์ต่างไป
//
//  ⚠️ ทุก detail มี "v" เป็นเวอร์ชันของ schema ตั้งแต่แถวแรก
//     log เป็นข้อมูลที่อยู่ยาว — เพิ่ม field ทีหลังแล้วอ่านแถวเก่าได้ต้องมีตัวบอก
//     รุ่น ไม่ใช่เดาจากการมี/ไม่มีคีย์
// ═══════════════════════════════════════════════════════════════════════════
public static class ActivityEntry
{
    private const int SchemaVersion = 1;

    /// <summary>
    /// ประกอบแถวประวัติ — คืน entity ที่ยังไม่ถูกเขียน ผู้เรียกส่งต่อให้ repository
    /// เขียนในธุรกรรมเดียวกับการเปลี่ยนแปลง
    /// </summary>
    /// <param name="detail">
    /// คู่ค่าเพิ่มเติม เช่น ("from", "todo"), ("to", "done") — คีย์ "v" ถูกเติมให้เอง
    ///
    /// เก็บค่าเดิมไว้ด้วยเสมอ ไม่ใช่แค่ค่าใหม่: ปุ่มย้อนกลับต้องใช้ และประวัติที่
    /// บอกแต่ผลลัพธ์ตอบไม่ได้ว่าเปลี่ยนมาจากอะไร
    /// </param>
    public static ActivityLog Build(
        Guid workspaceId,
        Guid pageId,
        string pageTitle,
        Guid actorUserId,
        string action,
        params (string Key, object? Value)[] detail)
    {
        var payload = new Dictionary<string, object?> { ["v"] = SchemaVersion };

        foreach (var (key, value) in detail) payload[key] = value;

        return new ActivityLog
        {
            WorkspaceId = workspaceId,
            PageId = pageId,
            // ตัดตามความยาวคอลัมน์ — ชื่อหน้ายาวเกินไม่ควรทำให้การบันทึกประวัติล้ม
            // ทั้งแถว เพราะประวัติเป็นผลข้างเคียงของสิ่งที่ผู้ใช้ตั้งใจทำ
            PageTitle = Truncate(pageTitle, 400),
            ActorUserId = actorUserId,
            Action = action,
            Detail = JsonSerializer.SerializeToDocument(payload),
            CreatedAt = DateTimeOffset.UtcNow
        };
    }

    /// <summary>ค่าที่ใช้แทน "ไม่มีสถานะ" ใน detail — null ใน JSON อ่านกำกวมกว่า</summary>
    public static string StatusOrNone(string? status) => status ?? PageStatusNone;

    public const string PageStatusNone = "none";

    private static string Truncate(string value, int max)
        => value.Length <= max ? value : value[..max];
}
