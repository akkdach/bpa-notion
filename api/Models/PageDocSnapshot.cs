namespace ProjectManagementAPI.Models;

/// <summary>
/// snapshot ของ Yjs document — client เป็นคนสร้างและส่งมา
/// (`Y.encodeStateAsUpdate(doc)`) เพราะเซิร์ฟเวอร์ merge CRDT เองไม่ได้
///
/// ⚠️ นี่คือ trust boundary: client ที่ "มีบั๊ก" (ไม่ต้องถึงขั้นมุ่งร้าย) ส่ง
///    snapshot ที่ข้อมูลหายมาได้ การเก็บ 3 generation + เงื่อนไขห้าม prune
///    เมื่อขนาดหดเกินครึ่ง ทำให้ "กู้คืนได้" ไม่ใช่ "เกิดขึ้นไม่ได้"
/// </summary>
public class PageDocSnapshot
{
    public long Id { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid PageId { get; set; }

    public byte[] Snapshot { get; set; } = [];

    /// <summary>snapshot นี้ครอบคลุม update ถึง seq ไหน</summary>
    public long UpToSeq { get; set; }

    /// <summary>เก็บแยกไว้เพื่อเทียบขนาดกับ snapshot ก่อนหน้า (guard กัน snapshot ที่หายข้อมูล)</summary>
    public int ByteSize { get; set; }

    /// <summary>
    /// snapshot นี้ใช้เสิร์ฟ bootstrap ได้หรือไม่
    ///
    /// ⚠️ คอลัมน์นี้เกิดจากบั๊กที่เทสจับได้: การ "เก็บไว้แต่ไม่ prune" อย่างเดียว
    ///    ไม่พอ เพราะ bootstrap หยิบ snapshot ที่ up_to_seq สูงสุดมาเสิร์ฟ แล้ว
    ///    ข้าม update ที่เก่ากว่านั้นไปทั้งหมด ผลคือข้อมูลยังอยู่ในฐานแต่ผู้ใช้
    ///    เห็นหน้าว่าง ซึ่งแย่พอ ๆ กับข้อมูลหายจริง
    ///
    ///    snapshot ที่เล็กลงผิดปกติจึงถูกเก็บแบบ is_trusted = false: ไม่ใช้เสิร์ฟ
    ///    ไม่ prune แต่ยังอยู่ให้ตรวจสอบ และใช้เป็น "พยาน" ให้ snapshot ตัวถัดไป
    ///    ที่ขนาดใกล้กันได้ (ถ้ามีสองตัวที่เล็กเท่า ๆ กัน แปลว่าผู้ใช้ลบเนื้อหา
    ///    จริง ไม่ใช่ client ส่งของไม่ครบ)
    /// </summary>
    public bool IsTrusted { get; set; } = true;

    public Guid? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
