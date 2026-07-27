using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;

namespace ProjectManagementAPI.Services.Abstractions;

public interface IDocumentService
{
    /// <summary>ทุกอย่างที่ client ต้องใช้ประกอบเอกสารขึ้นมาใหม่</summary>
    Task<Result<DocumentBootstrap>> GetBootstrapAsync(Guid pageId, CancellationToken ct = default);

    Task<Result<AppendUpdateResult>> AppendUpdateAsync(
        Guid pageId, byte[] update, long? yClientId, CancellationToken ct = default);

    Task<Result<SnapshotResult>> SaveSnapshotAsync(
        Guid pageId, byte[] snapshot, long upToSeq, CancellationToken ct = default);

    Task<Result> SaveProjectionAsync(
        Guid pageId, ProjectionRequest request, CancellationToken ct = default);

    /// <summary>หน้าที่ลิงก์มาหาหน้านี้ — กรองตามสิทธิ์ของหน้าต้นทางแล้ว</summary>
    Task<Result<IReadOnlyList<BacklinkDto>>> GetBacklinksAsync(
        Guid pageId, CancellationToken ct = default);

    /// <summary>
    /// เนื้อหาหน้าเป็น plain text — ต้องมีสิทธิ์ "อ่าน" หน้านั้น
    ///
    /// ทางเดียวที่เซิร์ฟเวอร์และ AI อ่านเนื้อหาได้ เพราะเอกสารจริงเป็น CRDT ทึบ
    /// คืน freshness มาด้วยเสมอ เพื่อให้ผู้เรียกแยก "หน้าว่าง" จาก "ยังไม่มีข้อมูล" ได้
    /// </summary>
    Task<Result<PageContentDto>> GetContentAsync(Guid pageId, CancellationToken ct = default);

    /// <summary>
    /// ต่อท้ายย่อหน้าธรรมดาเข้าไปในเอกสาร — ทางเดียวที่เซิร์ฟเวอร์เขียนเนื้อหาได้
    /// </summary>
    /// <remarks>
    /// ⚠️ ย่อหน้าธรรมดาเท่านั้น ไม่มี heading / list / table / mark
    ///    เหตุผลเต็มอยู่ที่ BlockNoteWriter — สรุปคือ schema ของ BlockNote นิยามใน
    ///    TypeScript และเป็น 0.x การ clone มาเป็น C# ทั้งชุดไม่มีอะไรตรวจว่าตรงกัน
    ///    ส่วนรูปร่างที่ผิดทำ "ข้อมูลหายจริง" ไม่ใช่แค่ render พลาด
    ///
    /// ⚠️ ต่อท้ายเสมอ ไม่มีทางแก้หรือลบของเดิม — เจตนา ไม่ใช่ข้อจำกัดชั่วคราว
    ///    การให้เซิร์ฟเวอร์ลบเนื้อหาที่คนเขียนคือความสามารถที่ความเสี่ยงสูงกว่าประโยชน์
    /// </remarks>
    Task<Result<AppendParagraphsResult>> AppendParagraphsAsync(
        Guid pageId, IReadOnlyList<string> paragraphs, CancellationToken ct = default);
}

/// <param name="Seq">ลำดับของ update ที่เขียนลง log</param>
/// <param name="ParagraphCount">จำนวนย่อหน้าที่เพิ่มเข้าไป</param>
public record AppendParagraphsResult(long Seq, int ParagraphCount);

/// <param name="Frames">ไบนารี [u32 count][u32 len][bytes]… frame 0 = snapshot</param>
public record DocumentBootstrap(
    Guid PageId,
    string Role,
    byte[] Frames,
    long HeadSeq,
    long SnapshotUpToSeq,
    int UpdatesSinceSnapshot,
    bool ShouldCompact);

public record AppendUpdateResult(long Seq, bool ShouldCompact);

/// <param name="PrunedUpdates">จำนวน update ที่ถูกลบทิ้งหลัง compact</param>
/// <param name="PruneSkipped">true = snapshot เล็กผิดปกติ เลยเก็บแต่ไม่ prune</param>
public record SnapshotResult(long UpToSeq, int ByteSize, int PrunedUpdates, bool PruneSkipped);
