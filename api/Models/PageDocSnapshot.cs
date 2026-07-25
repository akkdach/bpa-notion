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

    public Guid? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
