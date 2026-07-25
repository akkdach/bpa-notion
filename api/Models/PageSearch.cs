namespace ProjectManagementAPI.Models;

/// <summary>
/// projection สำหรับค้นหา — เป็นข้อมูล derived ทั้งหมด
///
/// client ส่ง plain text ที่แกะจาก Yjs document มาให้หลังหยุดพิมพ์
/// ถ้าค่านี้ล้าสมัย ผลค้นหาจะล้าสมัย แต่ไม่มีอะไรเสียหาย — สร้างใหม่ได้เสมอ
/// จากเอกสารจริง
///
/// ⚠️ PGroonga index บนตารางนี้ "ต้อง" ระบุ tokenizer เป็น bigram
///    ค่า default ตัดคำด้วยช่องว่าง ซึ่งกับภาษาไทยแปลว่าค้นเจอเฉพาะคำที่เป็น
///    prefix ของทั้งประโยค ดู db/probe/thai-search-probe.sql
/// </summary>
public class PageSearch
{
    public Guid PageId { get; set; }
    public Guid WorkspaceId { get; set; }

    /// <summary>denormalise มาที่นี่เพื่อกรองสิทธิ์ใน query เดียว ไม่ต้องเช็คทีละผลลัพธ์</summary>
    public Guid AccessRootId { get; set; }

    public Guid? DatabaseId { get; set; }

    public string Title { get; set; } = string.Empty;
    public string BodyText { get; set; } = string.Empty;

    /// <summary>generated column: title || ' ' || body_text (คำนวณโดย Postgres)</summary>
    public string SearchText { get; private set; } = string.Empty;

    public DateTimeOffset UpdatedAt { get; set; }
}
