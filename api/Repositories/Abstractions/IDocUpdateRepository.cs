using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Repositories.Abstractions;

public interface IDocUpdateRepository
{
    /// <summary>
    /// อ่านทุกอย่างที่ต้องใช้ประกอบเอกสารขึ้นมาใหม่ ใน transaction เดียว
    ///
    /// ⚠️ ต้องเป็น REPEATABLE READ — ถ้าอ่าน snapshot กับ update คนละจังหวะ
    ///    อาจได้ snapshot ใหม่ที่ครอบคลุมถึง seq 100 พร้อม update ที่ถูก prune
    ///    ไปแล้วบางส่วน = เอกสารมีรู
    /// </summary>
    Task<DocumentState> ReadStateAsync(Guid pageId, CancellationToken ct = default);

    Task<long> AppendUpdateAsync(PageDocUpdate update, CancellationToken ct = default);

    Task<long> GetHeadSeqAsync(Guid pageId, CancellationToken ct = default);

    Task<DocumentStats> GetStatsAsync(Guid pageId, CancellationToken ct = default);

    /// <summary>
    /// บันทึก snapshot แล้ว prune update ที่ snapshot รุ่นก่อนหน้าครอบคลุมแล้ว
    /// คืนจำนวน update ที่ถูกลบ
    /// </summary>
    Task<int> SaveSnapshotAndPruneAsync(
        PageDocSnapshot snapshot, bool allowPrune, CancellationToken ct = default);

    /// <summary>snapshot ล่าสุดที่ "ใช้เสิร์ฟได้" (IsTrusted)</summary>
    Task<PageDocSnapshot?> GetLatestSnapshotAsync(Guid pageId, CancellationToken ct = default);

    /// <summary>snapshot ล่าสุดที่ถูกกันไว้เพราะเล็กผิดปกติ — ใช้เป็นพยานให้ตัวถัดไป</summary>
    Task<PageDocSnapshot?> GetLatestUntrustedSnapshotAsync(Guid pageId, CancellationToken ct = default);

    /// <summary>projection สำหรับค้นหา — upsert เพราะหน้าหนึ่งมีได้แถวเดียว</summary>
    Task UpsertSearchProjectionAsync(
        Guid pageId, Guid accessRootId, string title, string bodyText,
        CancellationToken ct = default);
}

/// <param name="Snapshot">null ถ้ายังไม่เคย compact</param>
/// <param name="Updates">update ที่เกิดหลัง snapshot เรียงตาม seq</param>
/// <param name="HeadSeq">seq ล่าสุด — client ใช้รู้ว่าตัวเองตามทันถึงไหน</param>
public record DocumentState(
    byte[]? Snapshot,
    long SnapshotUpToSeq,
    IReadOnlyList<byte[]> Updates,
    long HeadSeq);

public record DocumentStats(
    long HeadSeq,
    long SnapshotUpToSeq,
    int UpdatesSinceSnapshot,
    int LatestSnapshotBytes);
