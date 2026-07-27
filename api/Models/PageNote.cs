namespace ProjectManagementAPI.Models;

// ═══════════════════════════════════════════════════════════════════════════
//  PageNote — บันทึกสั้น ๆ ต่อท้ายหน้า (append-only)
//
//  มีอยู่เพื่อให้ AI "เขียนข้อความเป็นภาษาคน" ได้โดยไม่ต้องแตะ Yjs
//
//  เนื้อหาของหน้าเป็น CRDT ที่เซิร์ฟเวอร์เขียนไม่ได้อย่างปลอดภัย (โครงผิดนิดเดียว
//  y-prosemirror ลบ element แล้วกระจายการลบไปทุก client) ตารางนี้จึงเป็นช่องเขียน
//  ที่ให้ AI รายงานความคืบหน้า ตั้งคำถาม หรือสรุปสิ่งที่ทำไปได้ ด้วยความเสี่ยง
//  ต่อข้อมูลเป็นศูนย์ และเจ้าของอ่านแยกจากเอกสารของตัวเองได้ชัดเจน
//
//  ⚠️ append-only โดยเจตนา ไม่มี UpdatedAt และไม่มีทางแก้
//     บันทึกที่แก้ย้อนหลังได้ไม่ใช่บันทึก — ถ้า AI เขียนผิดให้เขียนใหม่ต่อท้าย
//     ประวัติที่เห็นการแก้ตัวเป็นข้อมูลที่มีค่ากว่าประวัติที่ดูสะอาด
// ═══════════════════════════════════════════════════════════════════════════
public class PageNote
{
    public Guid Id { get; set; }

    /// <summary>ส่วนหนึ่งของ composite FK ไป pages(workspace_id, id)</summary>
    public Guid WorkspaceId { get; set; }

    public Guid PageId { get; set; }

    /// <summary>null เมื่อบัญชีผู้เขียนถูกลบไปแล้ว — บันทึกยังต้องอ่านได้</summary>
    public Guid? AuthorUserId { get; set; }

    public string Body { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    public Page? Page { get; set; }
}
