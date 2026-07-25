namespace ProjectManagementAPI.Models;

/// <summary>
/// Yjs update log — append-only
///
/// เซิร์ฟเวอร์ "ไม่แกะ" ก้อนนี้เลย มันเป็น bytea ทึบ ๆ
/// ที่ทำได้เพราะ Yjs update เป็น commutative + idempotent เซิร์ฟเวอร์ที่การันตี
/// แค่ "ทุก update ถึงทุก peer ในที่สุด" ก็ converge ได้ตามทฤษฎี
///
/// ⚠️ ตารางนี้จะเป็นตารางที่มีจำนวนแถวมากที่สุดในระบบ
///    ~1 update ต่อ keystroke ถ้าไม่มี batching (ดู YUpdateWriter, Phase 2)
///    เกิน ~50M แถวให้พิจารณา PARTITION BY HASH (page_id)
/// </summary>
public class PageDocUpdate
{
    /// <summary>identity — ลำดับที่ client ใช้ bootstrap และใช้ตัดสินว่า compact ถึงไหน</summary>
    public long Seq { get; set; }

    public Guid WorkspaceId { get; set; }
    public Guid PageId { get; set; }

    public byte[] Update { get; set; } = [];

    /// <summary>Yjs clientID ของผู้ส่ง — ใช้เลือกว่าใครเป็นคน compact</summary>
    public long? YClientId { get; set; }

    public Guid? AuthorUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
