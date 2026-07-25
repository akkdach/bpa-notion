using System.Data;
using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Repositories;

// ═══════════════════════════════════════════════════════════════════════════
//  DocUpdateRepository
//
//  เก็บ Yjs update เป็น bytea ทึบ ๆ เซิร์ฟเวอร์ไม่แกะเลย
//  ที่ทำได้เพราะ Yjs update เป็น commutative + idempotent เซิร์ฟเวอร์ที่การันตี
//  แค่ "ทุก update ถึงทุก peer ในที่สุด" ก็ converge ได้ตามทฤษฎี
// ═══════════════════════════════════════════════════════════════════════════
public class DocUpdateRepository(AppDbContext db, ILogger<DocUpdateRepository> logger)
    : IDocUpdateRepository
{
    /// <summary>เก็บ snapshot ไว้กี่รุ่น — เผื่อไว้กู้เมื่อ client ส่ง snapshot ที่ข้อมูลหาย</summary>
    private const int SnapshotGenerationsToKeep = 3;

    public async Task<DocumentState> ReadStateAsync(
        Guid pageId, CancellationToken ct = default)
    {
        // ─────────────────────────────────────────────────────────────────
        //  REPEATABLE READ
        //
        //  ถ้าอ่าน snapshot แล้วมี client อื่น compact ก่อนเราจะอ่าน update
        //  เราจะได้ snapshot เก่า + update ที่ถูก prune ไปบางส่วน = เอกสารมีรู
        //  ที่กู้ไม่ได้ ราคาของ isolation level นี้ต่ำมากเพราะเป็น read-only
        //  และสั้น
        // ─────────────────────────────────────────────────────────────────
        return await db.Database
            .CreateExecutionStrategy()
            .ExecuteAsync(async () =>
            {
                await using var transaction =
                    await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);

                // ⚠️ IsTrusted เท่านั้น — snapshot ที่เล็กลงผิดปกติถูกเก็บไว้
                //    แต่ห้ามใช้เสิร์ฟ ไม่งั้นข้อมูลจะ "หาย" จากมุมผู้ใช้ทั้งที่
                //    ยังอยู่ในฐาน (ดู PageDocSnapshot.IsTrusted)
                var snapshot = await db.PageDocSnapshots
                    .AsNoTracking()
                    .Where(s => s.PageId == pageId && s.IsTrusted)
                    .OrderByDescending(s => s.UpToSeq)
                    .FirstOrDefaultAsync(ct);

                var fromSeq = snapshot?.UpToSeq ?? 0;

                var updates = await db.PageDocUpdates
                    .AsNoTracking()
                    .Where(u => u.PageId == pageId && u.Seq > fromSeq)
                    .OrderBy(u => u.Seq)
                    .Select(u => u.Update)
                    .ToListAsync(ct);

                var headSeq = await db.PageDocUpdates
                    .Where(u => u.PageId == pageId)
                    .MaxAsync(u => (long?)u.Seq, ct) ?? fromSeq;

                await transaction.CommitAsync(ct);

                return new DocumentState(snapshot?.Snapshot, fromSeq, updates, headSeq);
            });
    }

    public async Task<long> AppendUpdateAsync(
        PageDocUpdate update, CancellationToken ct = default)
    {
        db.PageDocUpdates.Add(update);
        await db.SaveChangesAsync(ct);
        return update.Seq;
    }

    public async Task<long> GetHeadSeqAsync(Guid pageId, CancellationToken ct = default)
        => await db.PageDocUpdates
                   .Where(u => u.PageId == pageId)
                   .MaxAsync(u => (long?)u.Seq, ct) ?? 0;

    public async Task<DocumentStats> GetStatsAsync(Guid pageId, CancellationToken ct = default)
    {
        var snapshot = await db.PageDocSnapshots
            .AsNoTracking()
            .Where(s => s.PageId == pageId)
            .OrderByDescending(s => s.UpToSeq)
            .Select(s => new { s.UpToSeq, s.ByteSize })
            .FirstOrDefaultAsync(ct);

        var upTo = snapshot?.UpToSeq ?? 0;

        var head = await db.PageDocUpdates
            .Where(u => u.PageId == pageId)
            .MaxAsync(u => (long?)u.Seq, ct) ?? upTo;

        var since = await db.PageDocUpdates
            .CountAsync(u => u.PageId == pageId && u.Seq > upTo, ct);

        return new DocumentStats(head, upTo, since, snapshot?.ByteSize ?? 0);
    }

    public Task<PageDocSnapshot?> GetLatestSnapshotAsync(
        Guid pageId, CancellationToken ct = default)
        => db.PageDocSnapshots
             .AsNoTracking()
             .Where(s => s.PageId == pageId && s.IsTrusted)
             .OrderByDescending(s => s.UpToSeq)
             .FirstOrDefaultAsync(ct);

    public Task<PageDocSnapshot?> GetLatestUntrustedSnapshotAsync(
        Guid pageId, CancellationToken ct = default)
        => db.PageDocSnapshots
             .AsNoTracking()
             .Where(s => s.PageId == pageId && !s.IsTrusted)
             .OrderByDescending(s => s.UpToSeq)
             .FirstOrDefaultAsync(ct);

    // ═══════════════════════════════════════════════════════════════════════
    //  บันทึก snapshot + prune
    //
    //  ⚠️ prune เฉพาะ update ที่ snapshot "รุ่นก่อนหน้า" ครอบคลุมแล้ว
    //     ไม่ใช่รุ่นล่าสุด — เก็บ update ไว้เกินหนึ่งรุ่นเสมอ
    //
    //  เหตุผล: snapshot มาจาก client ซึ่งอาจมีบั๊ก (ไม่ต้องถึงขั้นมุ่งร้าย —
    //  แค่ snapshot เอกสารที่ตัวเองยังใช้ update ไม่ครบก็พอ) การเก็บ update
    //  ของรุ่นล่าสุดไว้ทำให้ยัง rebuild จาก snapshot รุ่นก่อนได้อยู่
    // ═══════════════════════════════════════════════════════════════════════
    public Task<int> SaveSnapshotAndPruneAsync(
        PageDocSnapshot snapshot, bool allowPrune, CancellationToken ct = default)
        => db.InTransactionAsync(async token =>
        {
            db.PageDocSnapshots.Add(snapshot);
            await db.SaveChangesAsync(token);

            if (!allowPrune) return 0;

            // seq ที่ snapshot รุ่นก่อนหน้า (ลำดับที่สองจากล่าสุด) ครอบคลุม
            var previousUpTo = await db.PageDocSnapshots
                .Where(s => s.PageId == snapshot.PageId && s.IsTrusted)
                .OrderByDescending(s => s.UpToSeq)
                .Skip(1)
                .Select(s => (long?)s.UpToSeq)
                .FirstOrDefaultAsync(token);

            var pruned = 0;

            if (previousUpTo is { } boundary)
            {
                pruned = await db.PageDocUpdates
                    .Where(u => u.PageId == snapshot.PageId && u.Seq <= boundary)
                    .ExecuteDeleteAsync(token);
            }

            // เก็บ snapshot ไว้ 3 รุ่น
            var keep = await db.PageDocSnapshots
                .Where(s => s.PageId == snapshot.PageId && s.IsTrusted)
                .OrderByDescending(s => s.UpToSeq)
                .Take(SnapshotGenerationsToKeep)
                .Select(s => s.Id)
                .ToListAsync(token);

            await db.PageDocSnapshots
                .Where(s => s.PageId == snapshot.PageId && s.IsTrusted && !keep.Contains(s.Id))
                .ExecuteDeleteAsync(token);

            logger.LogInformation(
                "compact หน้า {PageId} ถึง seq {UpToSeq} — ลบ update {Pruned} แถว",
                snapshot.PageId, snapshot.UpToSeq, pruned);

            return pruned;
        }, ct);

    // ═══════════════════════════════════════════════════════════════════════
    //  projection สำหรับค้นหา
    //
    //  เป็นข้อมูล derived ทั้งหมด — ถ้าล้าสมัย ผลค้นหาล้าสมัย แต่ไม่มีอะไรเสีย
    //  สร้างใหม่ได้เสมอจากเอกสารจริง
    // ═══════════════════════════════════════════════════════════════════════
    public async Task UpsertSearchProjectionAsync(
        Guid pageId, Guid accessRootId, string title, string bodyText,
        CancellationToken ct = default)
    {
        var existing = await db.PageSearches.FirstOrDefaultAsync(s => s.PageId == pageId, ct);

        if (existing is null)
        {
            db.PageSearches.Add(new PageSearch
            {
                PageId = pageId,
                WorkspaceId = db.CurrentWorkspaceId
                    ?? throw new InvalidOperationException("ไม่มี workspace context"),
                AccessRootId = accessRootId,
                Title = title,
                BodyText = bodyText,
                UpdatedAt = DateTimeOffset.UtcNow
            });
        }
        else
        {
            existing.AccessRootId = accessRootId;
            existing.Title = title;
            existing.BodyText = bodyText;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(ct);
    }
}
