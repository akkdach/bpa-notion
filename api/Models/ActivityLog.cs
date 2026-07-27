using System.Text.Json;

namespace ProjectManagementAPI.Models;

// ═══════════════════════════════════════════════════════════════════════════
//  ActivityLog — ใครทำอะไรกับหน้าไหนเมื่อไหร่
//
//  ทำไมต้องมีตารางใหม่ ไม่ derive จาก page_doc_updates ที่มีอยู่แล้ว:
//
//    · page_doc_updates บันทึกว่า "ใครส่ง CRDT delta" ไม่ใช่ "อะไรเปลี่ยน"
//      การรู้ว่าอะไรเปลี่ยนต้องแกะ CRDT ซึ่งเป็นสิ่งที่เซิร์ฟเวอร์ทำไม่ได้โดยเจตนา
//    · เปลี่ยนสถานะ / ย้าย / ลบ / กู้คืน / เขียนบันทึก **ไม่แตะตารางนั้นเลย**
//      มันเป็นการ UPDATE แถวใน pages ล้วน ๆ จึงไม่มีอะไรให้ derive ตั้งแต่ต้น
//    · และ page_doc_updates ถูก prune ตอน compact จึงไม่ใช่ประวัติที่คงทน
//
//  ⚠️ ต้องเขียนใน "ธุรกรรมเดียวกับการเปลี่ยนแปลง" ไม่ใช่หลังจากนั้น
//     ไม่งั้น log จะโกหก: มีแถวบอกว่าเปลี่ยนแล้วแต่ข้อมูลไม่ได้เปลี่ยน หรือกลับกัน
// ═══════════════════════════════════════════════════════════════════════════
public class ActivityLog
{
    public long Id { get; set; }

    public Guid WorkspaceId { get; set; }

    /// <summary>
    /// null เมื่อหน้าถูกลบถาวรไปแล้ว (ON DELETE SET NULL)
    /// </summary>
    /// <remarks>
    /// ⚠️ ถ้าใช้ ON DELETE CASCADE เหมือน page_searches การ purge จะลบ log ของหน้านั้น
    ///    ทิ้งไปด้วย — ซึ่งเป็นการลบหลักฐานพอดีตอนที่คำถาม "ใครลบหน้านี้" มีค่าที่สุด
    ///    จึงยอมให้แถวกำพร้าอยู่ต่อ แล้วเก็บ PageTitle ไว้ให้อ่านรู้เรื่อง
    /// </remarks>
    public Guid? PageId { get; set; }

    /// <summary>
    /// สำเนาชื่อหน้าตอนเกิดเหตุ — ไม่ใช่ denormalise เพื่อความเร็ว
    ///
    /// เก็บไว้เพราะ (ก) หน้าอาจถูกลบถาวรไปแล้ว และ (ข) ชื่อหน้าเปลี่ยนได้
    /// ประวัติควรบอกว่า "ตอนนั้นมันชื่ออะไร" ไม่ใช่ชื่อวันนี้
    /// </summary>
    public string PageTitle { get; set; } = string.Empty;

    /// <summary>null เมื่อบัญชีถูกลบ — ดู ActivityAction สำหรับค่าที่เป็นไปได้</summary>
    public Guid? ActorUserId { get; set; }

    public string Action { get; set; } = string.Empty;

    /// <summary>
    /// รายละเอียดของการเปลี่ยนแปลง — มี "v" เป็นเวอร์ชันของ schema ตั้งแต่แถวแรก
    ///
    /// เก็บค่าเดิม (from) ไว้ด้วยเสมอ ไม่ใช่แค่ค่าใหม่ เพราะปุ่ม "ย้อนกลับ" ต้องใช้
    /// และเพราะประวัติที่บอกแต่ผลลัพธ์ตอบไม่ได้ว่าเปลี่ยนจากอะไร
    /// </summary>
    public JsonDocument? Detail { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
