using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  DocumentService — เนื้อหาของหน้า (Yjs)
//
//  Phase 1: client ส่ง update มาทาง REST
//  Phase 2: ย้ายไป SignalR แล้ว REST เหลือไว้แค่ bootstrap กับ snapshot
//           (ตั้งใจให้ bootstrap อยู่บน REST ตั้งแต่แรก เพราะ SignalR จำกัด
//            ข้อความไว้ 32KB โดย default และ full-state ใหญ่กว่านั้นได้ง่าย)
// ═══════════════════════════════════════════════════════════════════════════
public class DocumentService(
    IDocUpdateRepository documents,
    IPageRepository pages,
    IPermissionService permissions,
    ITenantContext tenant,
    ILogger<DocumentService> logger) : IDocumentService
{
    /// <summary>compact เมื่อ update สะสมเกินนี้</summary>
    private const int CompactThreshold = 300;

    /// <summary>
    /// snapshot ที่เล็กกว่ารุ่นก่อนเกินครึ่ง = น่าสงสัยว่าข้อมูลหาย
    /// ยังเก็บไว้ (การลบเนื้อหาจำนวนมากก็ทำให้เล็กลงได้จริง) แต่ไม่ prune
    /// </summary>
    private const double SuspiciousShrinkRatio = 0.5;

    /// <summary>
    /// จำนวน backlink สูงสุดที่คืนกลับ
    ///
    /// มีเพดานเพราะแต่ละแถวต้องเช็คสิทธิ์ทีละหน้า — หน้าที่ถูกอ้างถึงจาก 5,000 ที่
    /// (เช่นหน้าสารบัญกลาง) จะกลายเป็น 5,000 permission check ต่อการเปิดหนึ่งครั้ง
    /// </summary>
    private const int BacklinkLimit = 50;

    /// <summary>
    /// เพดานย่อหน้าต่อการเรียกหนึ่งครั้ง
    ///
    /// การเขียนทีละมาก ๆ ทำให้ update ก้อนเดียวใหญ่ และถ้ารูปร่างผิดก็เสียหายกว้าง
    /// AI ที่อยากเขียนยาวกว่านี้ควรเรียกซ้ำ — ระหว่างนั้นมีจังหวะให้เห็นผลก่อน
    /// </summary>
    private const int MaxParagraphsPerCall = 50;

    public async Task<Result<DocumentBootstrap>> GetBootstrapAsync(
        Guid pageId, CancellationToken ct = default)
    {
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;

        var state = await documents.ReadStateAsync(pageId, ct);
        var stats = await documents.GetStatsAsync(pageId, ct);

        return new DocumentBootstrap(
            PageId: pageId,
            Role: role.Value.ToDbValue(),
            Frames: BuildFrames(state),
            HeadSeq: state.HeadSeq,
            SnapshotUpToSeq: state.SnapshotUpToSeq,
            UpdatesSinceSnapshot: stats.UpdatesSinceSnapshot,
            ShouldCompact: stats.UpdatesSinceSnapshot > CompactThreshold);
    }

    public async Task<Result<AppendUpdateResult>> AppendUpdateAsync(
        Guid pageId, byte[] update, long? yClientId, CancellationToken ct = default)
    {
        if (update.Length == 0)
        {
            return Error.Validation("update ว่าง", "empty_update");
        }

        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;
        if (!role.Value.CanEdit()) return NoEditPermission;

        var seq = await documents.AppendUpdateAsync(new PageDocUpdate
        {
            WorkspaceId = tenant.RequireWorkspaceId(),
            PageId = pageId,
            Update = update,
            YClientId = yClientId,
            AuthorUserId = tenant.RequireUserId()
        }, ct);

        var stats = await documents.GetStatsAsync(pageId, ct);

        return new AppendUpdateResult(
            seq,
            stats.UpdatesSinceSnapshot > CompactThreshold);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Snapshot — client เป็นคนสร้าง เพราะเซิร์ฟเวอร์ merge CRDT เองไม่ได้
    //
    //  ⚠️ นี่คือ trust boundary จุดเดียวในระบบที่ client เขียนข้อมูลที่เรา
    //     ตรวจสอบเนื้อหาไม่ได้ ทุกด่านข้างล่างมีไว้เพื่อให้ความผิดพลาด
    //     "กู้คืนได้" ไม่ใช่ "เกิดขึ้นไม่ได้"
    // ═══════════════════════════════════════════════════════════════════════
    public async Task<Result<SnapshotResult>> SaveSnapshotAsync(
        Guid pageId, byte[] snapshot, long upToSeq, CancellationToken ct = default)
    {
        // ─── ด่าน 1: ต้องมีสิทธิ์แก้ ───────────────────────────────────────
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;
        if (!role.Value.CanEdit()) return NoEditPermission;

        if (snapshot.Length == 0)
        {
            return Error.Validation("snapshot ว่าง", "empty_snapshot");
        }

        // ─── ด่าน 2: upToSeq ต้องไม่ล้ำหน้าความจริง ───────────────────────
        var headSeq = await documents.GetHeadSeqAsync(pageId, ct);

        if (upToSeq > headSeq)
        {
            logger.LogWarning(
                "ปฏิเสธ snapshot ของหน้า {PageId}: upToSeq {UpTo} > headSeq {Head}",
                pageId, upToSeq, headSeq);

            return Error.Validation(
                $"upToSeq ({upToSeq}) เกิน update ล่าสุด ({headSeq})", "snapshot_ahead");
        }

        // ─── ด่าน 3: มี snapshot ที่จุดนี้อยู่แล้ว ─────────────────────────
        //
        //  เกิดขึ้นได้จริงเมื่อสอง client ตัดสินใจ compact ที่ seq เดียวกัน
        //  พร้อมกัน — ไม่ใช่ความผิดพลาด แค่ทำซ้ำ
        //
        //  ต้องดักที่นี่ ไม่ปล่อยให้ไปชน unique index แล้วกลายเป็น 500
        //  (ซึ่งเป็นสิ่งที่เกิดตอนเทสรอบแรก) client ที่ได้ 409 แค่ข้ามไป
        var latest = await documents.GetLatestSnapshotAsync(pageId, ct);

        if (latest is not null && latest.UpToSeq == upToSeq)
        {
            return Error.Conflict(
                $"มี snapshot ที่ seq {upToSeq} อยู่แล้ว — client อื่น compact ไปก่อนแล้ว",
                "snapshot_exists");
        }

        // ─── ด่าน 4: ขนาดหดผิดปกติ = เก็บแต่ไม่ prune ─────────────────────

        var shrankSharply =
            latest is not null &&
            snapshot.Length < latest.ByteSize * SuspiciousShrinkRatio;

        // ─────────────────────────────────────────────────────────────────
        //  ต้องมี "พยาน" ก่อนจะเชื่อ snapshot ที่หดตัวแรง
        //
        //  ⚠️ ดีไซน์เดิม (เก็บไว้แต่ไม่ prune) ไม่พอ และเทสจับได้:
        //     bootstrap หยิบ snapshot ที่ up_to_seq สูงสุดมาเสิร์ฟ แล้วข้าม
        //     update ที่เก่ากว่าไปหมด ผลคือ update ยังอยู่ในฐานครบ แต่ผู้ใช้
        //     เห็นหน้าว่าง — ซึ่งแย่พอกับข้อมูลหายจริง
        //
        //  ทางแก้: snapshot แรกที่หดแรงถูกเก็บแบบ "ยังไม่เชื่อ" (ไม่ใช้เสิร์ฟ
        //  ไม่ prune) ถ้า snapshot ตัวถัดไปมีขนาดใกล้เคียงกัน แปลว่าเนื้อหา
        //  หดจริง (ผู้ใช้ลบเยอะ) ไม่ใช่ client ตัวเดียวส่งของไม่ครบ — ตอนนั้น
        //  ค่อยเชื่อ
        //
        //  ทำแบบนี้แล้วเรื่องจบได้เอง: การลบเนื้อหาจริงจะ compact ได้ในรอบที่
        //  สอง ส่วน client ที่มีบั๊กตัวเดียวจะไม่มีวันทำให้เอกสารหาย
        // ─────────────────────────────────────────────────────────────────
        var trusted = true;
        var corroborated = false;

        if (shrankSharply)
        {
            var witness = await documents.GetLatestUntrustedSnapshotAsync(pageId, ct);

            corroborated =
                witness is not null &&
                IsSimilarSize(snapshot.Length, witness.ByteSize);

            trusted = corroborated;

            if (corroborated)
            {
                logger.LogInformation(
                    "หน้า {PageId}: snapshot ที่หดตัวได้รับการยืนยันจากตัวก่อนหน้า " +
                    "({New} ไบต์ เทียบกับพยาน {Witness}) — เชื่อว่าเนื้อหาถูกลบจริง",
                    pageId, snapshot.Length, witness!.ByteSize);
            }
            else
            {
                logger.LogWarning(
                    "หน้า {PageId}: snapshot เล็กลงผิดปกติ ({New} จาก {Old} ไบต์) — " +
                    "เก็บไว้แบบยังไม่เชื่อ ไม่ใช้เสิร์ฟและไม่ prune " +
                    "รอ snapshot ตัวถัดไปมายืนยัน",
                    pageId, snapshot.Length, latest!.ByteSize);
            }
        }

        var pruned = await documents.SaveSnapshotAndPruneAsync(new PageDocSnapshot
        {
            WorkspaceId = tenant.RequireWorkspaceId(),
            PageId = pageId,
            Snapshot = snapshot,
            UpToSeq = upToSeq,
            ByteSize = snapshot.Length,
            IsTrusted = trusted,
            CreatedBy = tenant.RequireUserId()
        }, allowPrune: trusted, ct);

        return new SnapshotResult(upToSeq, snapshot.Length, pruned, PruneSkipped: !trusted);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Projection — client แกะ plain text จาก Y.Doc แล้วส่งมา
    //
    //  เซิร์ฟเวอร์อ่าน Yjs ไม่ได้ จึงไม่มีทางอื่น และไม่เป็นไรเพราะข้อมูลนี้
    //  derived ทั้งหมด: ถ้าล้าสมัย ผลค้นหาล้าสมัย ไม่มีอะไรเสียหาย
    // ═══════════════════════════════════════════════════════════════════════
    public async Task<Result> SaveProjectionAsync(
        Guid pageId, ProjectionRequest request, CancellationToken ct = default)
    {
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;
        if (!role.Value.CanEdit()) return NoEditPermission;

        var page = await pages.GetAsync(pageId, ct);
        if (page is null) return PageNotFound;

        var title = (request.Title ?? string.Empty).Trim();

        // title อยู่บน pages ด้วยเพราะ sidebar ต้องใช้ และไม่อยากให้ sidebar
        // ต้อง join page_searches
        //
        // ⚠️ ไม่เขียน activity ที่นี่โดยเจตนา (activity: null)
        //
        //    ทางนี้คือ autosave — เบราว์เซอร์ส่ง projection ทุกครั้งที่ผู้ใช้หยุดพิมพ์
        //    2 วินาที และ title คือ "บรรทัดแรกของเอกสาร" ซึ่งเปลี่ยนไปเรื่อย ๆ ระหว่าง
        //    พิมพ์ประโยคแรก ถ้าบันทึกประวัติทุกครั้ง ฟีดกิจกรรมจะถูกกลบด้วยการเปลี่ยน
        //    ชื่อทีละตัวอักษรจนมองไม่เห็นสิ่งที่ AI ทำ ซึ่งเป็นเหตุผลที่ฟีดมีอยู่
        //
        //    ผลที่ยอมรับ: การเปลี่ยนชื่อจากการพิมพ์ในเอกสารไม่โผล่ในฟีด ต่างจากการ
        //    เปลี่ยนชื่อผ่าน PATCH /pages/{id} (ซึ่งเป็นการกระทำที่ตั้งใจครั้งเดียว)
        if (title != page.Title)
        {
            await pages.UpdateTitleAsync(
                pageId, title, tenant.RequireUserId(), activity: null, ct);
        }

        await documents.UpsertSearchProjectionAsync(
            pageId,
            page.AccessRootId,
            title,
            Truncate(request.PlainText ?? string.Empty),
            ct);

        // ⚠️ null ≠ ว่าง — null คือ "client ไม่ได้ส่งช่องนี้มา" ให้คงลิงก์เดิม
        //    ถ้าตีความ null เป็น [] การ deploy โค้ดใหม่ทับ client เก่าจะล้างลิงก์
        //    ของทุกหน้าทิ้งทีละหน้าตามที่ผู้ใช้เปิด — ความเสียหายแบบค่อยเป็นค่อยไป
        //    ที่ไม่มีใครสังเกตจนสาย
        if (request.Links is not null)
        {
            await documents.ReplacePageLinksAsync(pageId, request.Links, ct);
        }

        return Result.Success();
    }

    /// <summary>หน้าที่ลิงก์มาหาหน้านี้</summary>
    // ═══════════════════════════════════════════════════════════════════════
    //  อ่านเนื้อหาเป็น plain text
    //
    //  ไม่ต้องมีสิทธิ์แก้ แค่เห็นหน้าก็อ่านได้ — ต่างจาก SaveProjectionAsync
    //  ที่ต้อง CanEdit() เพราะมันเขียน
    // ═══════════════════════════════════════════════════════════════════════
    public async Task<Result<PageContentDto>> GetContentAsync(
        Guid pageId, CancellationToken ct = default)
    {
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;

        var page = await pages.GetAsync(pageId, ct);
        if (page is null) return PageNotFound;

        var projection = await documents.GetSearchProjectionAsync(pageId, ct);

        // ─────────────────────────────────────────────────────────────────
        //  ไม่มีแถว = ยังไม่เคยมีเบราว์เซอร์เปิดหน้านี้
        //
        //  ต้องบอกให้ต่างจาก "หน้าว่าง" ให้ชัด ไม่งั้นผู้เรียก (โดยเฉพาะ AI)
        //  จะสรุปว่าหน้านี้ไม่มีเนื้อหาแล้วเขียนทับหรือรายงานผิด
        //
        //  หน้าที่สร้างหลังจากนี้จะมีแถวตั้งแต่เกิด (ดู PageRepository.AddAsync)
        //  ที่ยังไม่มีคือหน้าเก่าที่สร้างก่อนการเปลี่ยนแปลงนั้น
        // ─────────────────────────────────────────────────────────────────
        if (projection is null)
        {
            return new PageContentDto(
                page.Id, page.Title, string.Empty,
                ContentFreshness.Never, page.UpdatedAt, null);
        }

        return new PageContentDto(
            page.Id,
            // title จาก pages เป็นตัวจริง — projection.Title เป็นสำเนาที่อาจล้ากว่า
            page.Title,
            projection.BodyText,
            ContentFreshness.FromDocument,
            page.UpdatedAt,
            projection.UpdatedAt);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  เขียนย่อหน้าต่อท้ายเอกสาร — จุดเดียวที่เซิร์ฟเวอร์เขียน Yjs
    // ═══════════════════════════════════════════════════════════════════════
    public async Task<Result<AppendParagraphsResult>> AppendParagraphsAsync(
        Guid pageId, IReadOnlyList<string> paragraphs, CancellationToken ct = default)
    {
        var cleaned = paragraphs
            .Select(p => (p ?? string.Empty).ReplaceLineEndings("\n").Trim())
            .Where(p => p.Length > 0)
            .ToList();

        if (cleaned.Count == 0)
            return Error.Validation("ไม่มีย่อหน้าให้เขียน", "no_paragraphs");

        if (cleaned.Count > MaxParagraphsPerCall)
        {
            return Error.Validation(
                $"เขียนได้ครั้งละไม่เกิน {MaxParagraphsPerCall} ย่อหน้า", "too_many_paragraphs");
        }

        // ─────────────────────────────────────────────────────────────────
        //  ⚠️ ย่อหน้าที่มีขึ้นบรรทัดในตัวจะกลายเป็น "ย่อหน้าเดียวที่มี \n อยู่ข้างใน"
        //     ซึ่ง BlockNote ไม่มีโครงรองรับ — ProseMirror text node ไม่เก็บ newline
        //     เป็นอย่างอื่นนอกจากตัวอักษร ผลคือมันจะแสดงติดกันหมด
        //
        //     แตกให้เป็นคนละย่อหน้าเสียตรงนี้ ดีกว่าปล่อยให้ผู้เรียกเดาเอง
        // ─────────────────────────────────────────────────────────────────
        var expanded = cleaned
            .SelectMany(p => p.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            .Select(p => p.Trim())
            .Where(p => p.Length > 0)
            .ToList();

        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;
        if (!role.Value.CanEdit()) return NoEditPermission;

        var page = await pages.GetAsync(pageId, ct);
        if (page is null) return PageNotFound;

        // ─────────────────────────────────────────────────────────────────
        //  ประกอบเอกสารปัจจุบันแล้วสร้าง "ส่วนต่าง"
        //
        //  ต้องอ่านสถานะจริงก่อน ไม่ใช่เขียนทับ — เพื่อให้ update ที่ได้รวมกับ
        //  สิ่งที่ client อื่นเขียนพร้อมกันได้ตามปกติของ CRDT
        // ─────────────────────────────────────────────────────────────────
        var state = await documents.ReadStateAsync(pageId, ct);

        var existing = new List<byte[]>(state.Updates.Count + 1);
        if (state.Snapshot is { Length: > 0 }) existing.Add(state.Snapshot);
        existing.AddRange(state.Updates);

        AppendUpdate written;
        try
        {
            written = BlockNoteWriter.BuildAppendUpdate(existing, expanded);
        }
        catch (Exception ex)
        {
            // YDotNet เป็น binding ของ native library — ความผิดพลาดที่นี่ไม่ใช่
            // input ที่ผิด แต่เป็นบั๊กของเราหรือของ library จึง log ให้เห็นชัด
            logger.LogError(ex, "สร้าง Yjs update ไม่สำเร็จสำหรับหน้า {PageId}", pageId);
            return Error.Unavailable("เขียนเนื้อหาไม่สำเร็จ", "yjs_write_failed");
        }

        if (written.Bytes.Length == 0)
            return Error.Unavailable("สร้าง update ได้เป็นค่าว่าง", "yjs_write_empty");

        var appended = await AppendUpdateAsync(
            pageId, written.Bytes, unchecked((long)written.ClientId), ct);
        if (appended.IsFailure) return appended.Error;

        // ─────────────────────────────────────────────────────────────────
        //  อัปเดต projection ให้ค้นเจอทันที
        //
        //  ถ้าไม่ทำ ข้อความที่เพิ่งเขียนจะค้นไม่เจอจนกว่าจะมีคนเปิดหน้านั้นใน
        //  เบราว์เซอร์ — ปัญหาเดียวกับที่ page_searches ไม่ถูก seed ตอนสร้างหน้า
        //
        //  เบราว์เซอร์จะเขียนทับด้วยฉบับที่แกะจาก Y.Doc จริงในภายหลัง ซึ่งถูกต้อง
        //  กว่าเสมอ ที่นี่แค่ทำให้ช่วงเวลาระหว่างนั้นไม่ตาบอด
        // ─────────────────────────────────────────────────────────────────
        var projection = await documents.GetSearchProjectionAsync(pageId, ct);
        var body = projection?.BodyText ?? string.Empty;
        var addition = string.Join("\n", expanded);

        await documents.UpsertSearchProjectionAsync(
            pageId, page.AccessRootId, page.Title,
            Truncate(body.Length > 0 ? $"{body}\n{addition}" : addition), ct);

        logger.LogInformation(
            "เขียน {Count} ย่อหน้าลงหน้า {PageId} (seq {Seq})",
            expanded.Count, pageId, appended.Value.Seq);

        return new AppendParagraphsResult(appended.Value.Seq, expanded.Count);
    }

    public async Task<Result<IReadOnlyList<BacklinkDto>>> GetBacklinksAsync(
        Guid pageId, CancellationToken ct = default)
    {
        // ต้องมีสิทธิ์เห็นหน้าเป้าหมายก่อน ไม่งั้นรายการ backlink กลายเป็นช่อง
        // สำรวจว่าใน workspace มีหน้าอะไรอยู่บ้างโดยไม่ต้องมีสิทธิ์เห็นหน้านั้น
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;

        var sources = await documents.GetBacklinksAsync(pageId, BacklinkLimit, ct);

        // ─────────────────────────────────────────────────────────────────
        //  กรองตามสิทธิ์ของ "หน้าต้นทาง" ทีละหน้า
        //
        //  ⚠️ สิทธิ์เห็นหน้า A ไม่ได้แปลว่ามีสิทธิ์รู้ว่าหน้า B ลิงก์มาหา A —
        //     B อาจอยู่ใต้ access root ที่ผู้ใช้เข้าไม่ได้ ชื่อของ B เองก็เป็น
        //     ข้อมูลที่รั่วได้ ("แผนปรับเงินเดือน 2026" ลิงก์มาหาหน้านี้)
        //
        //  ยอมจ่ายเป็น N query เพราะ PermissionService memo ต่อ request อยู่แล้ว
        //  และ BacklinkLimit จำกัดไว้ที่ 50 — ถ้าถึงจุดที่ช้า ทางแก้คือ query
        //  เดียวที่กรองด้วย access_root_id = ANY($visibleRoots) เหมือนที่ search
        //  จะทำ ไม่ใช่การเลิกกรอง
        // ─────────────────────────────────────────────────────────────────
        var visible = new List<BacklinkDto>(sources.Count);

        foreach (var source in sources)
        {
            if (await permissions.GetEffectiveRoleAsync(source.Id, ct) is null) continue;
            visible.Add(new BacklinkDto(source.Id, source.Title, source.Icon, source.UpdatedAt));
        }

        return visible;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  รูปแบบไบนารีของ bootstrap
    //
    //      [u32 count][u32 len][bytes] × count
    //
    //  frame แรกคือ snapshot (ยาว 0 ถ้ายังไม่เคย compact) ที่เหลือคือ update
    //  เรียงตาม seq — client เอาไป Y.applyUpdate ทีละอันตามลำดับ
    //
    //  ใช้ไบนารีดิบไม่ใช่ JSON+base64 เพราะเอกสารขนาดกลางมี update หลายพัน
    //  ก้อน base64 จะทำให้ payload โต 33% บนเส้นทางที่วิ่งทุกครั้งที่เปิดหน้า
    // ═══════════════════════════════════════════════════════════════════════
    private static byte[] BuildFrames(DocumentState state)
    {
        var frames = new List<byte[]> { state.Snapshot ?? [] };
        frames.AddRange(state.Updates);

        var totalSize = 4 + frames.Sum(f => 4 + f.Length);
        var buffer = new byte[totalSize];
        var offset = 0;

        WriteUInt32(buffer, ref offset, (uint)frames.Count);

        foreach (var frame in frames)
        {
            WriteUInt32(buffer, ref offset, (uint)frame.Length);
            frame.CopyTo(buffer, offset);
            offset += frame.Length;
        }

        return buffer;
    }

    /// <summary>little-endian ให้ตรงกับ DataView ฝั่ง JS ที่อ่านด้วย littleEndian = true</summary>
    private static void WriteUInt32(byte[] buffer, ref int offset, uint value)
    {
        buffer[offset++] = (byte)(value & 0xFF);
        buffer[offset++] = (byte)((value >> 8) & 0xFF);
        buffer[offset++] = (byte)((value >> 16) & 0xFF);
        buffer[offset++] = (byte)((value >> 24) & 0xFF);
    }

    /// <summary>
    /// snapshot สองตัวขนาดใกล้กันพอที่จะถือว่า "ยืนยันกันเอง" หรือไม่
    ///
    /// ±25% เผื่อไว้เพราะระหว่างสอง snapshot ผู้ใช้ยังพิมพ์ต่อได้อีกนิดหน่อย
    /// แต่ถ้าห่างกันมากกว่านั้นแปลว่าสอง client เห็นเอกสารคนละแบบ ซึ่งเป็น
    /// สัญญาณว่ามีตัวหนึ่งข้อมูลไม่ครบ
    /// </summary>
    private static bool IsSimilarSize(int a, int b)
    {
        if (a == 0 || b == 0) return false;

        var larger = Math.Max(a, b);
        var smaller = Math.Min(a, b);

        return (double)smaller / larger >= 0.75;
    }

    /// <summary>
    /// จำกัดขนาด body ที่เก็บลง index ค้นหา
    /// เอกสารยาวมาก ๆ ทำให้ bigram index โตเร็วโดยที่ผลค้นหาไม่ได้ดีขึ้น
    /// </summary>
    private static string Truncate(string text, int max = 100_000)
        => text.Length <= max ? text : text[..max];

    private static Error PageNotFound => Error.NotFound("ไม่พบหน้านี้", "page_not_found");

    private static Error NoEditPermission =>
        Error.Forbidden("ไม่มีสิทธิ์แก้ไขหน้านี้", "insufficient_page_role");
}
