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
}

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
