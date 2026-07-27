using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  CollaborationService — บันทึกบนหน้า + ฟีดกิจกรรม
//
//  สองเรื่องนี้อยู่ service เดียวกันเพราะทำหน้าที่เดียวกัน: ทำให้เจ้าของตรวจงาน
//  ที่ AI ทำได้ อันหนึ่งคือสิ่งที่ AI "เล่า" อีกอันคือสิ่งที่ระบบ "บันทึกไว้เอง"
// ═══════════════════════════════════════════════════════════════════════════
public class CollaborationService(
    INoteRepository notes,
    IActivityRepository activity,
    IPageRepository pages,
    IPermissionService permissions,
    ITenantContext tenant,
    ILogger<CollaborationService> logger) : ICollaborationService
{
    private const int NoteLimit = 200;
    private const int DefaultActivityLimit = 50;
    private const int MaxActivityLimit = 200;
    private const int MaxBodyLength = 4000;

    public async Task<Result<NoteDto>> AddNoteAsync(
        Guid pageId, AddNoteRequest request, CancellationToken ct = default)
    {
        var body = (request.Body ?? string.Empty).Trim();

        if (body.Length == 0)
            return Error.Validation("บันทึกว่างเปล่าไม่ได้", "note_empty");

        if (body.Length > MaxBodyLength)
        {
            return Error.Validation(
                $"บันทึกยาวเกิน {MaxBodyLength} ตัวอักษร — เนื้อหายาวควรอยู่ในหน้า ไม่ใช่ในบันทึก",
                "note_too_long");
        }

        // ─────────────────────────────────────────────────────────────────
        //  ⚠️ CanComment ไม่ใช่ CanEdit
        //
        //  นี่คือจุดแรกในระบบที่ PageRole.Commenter ต่างจาก Viewer จริง ๆ
        //  ก่อนหน้านี้ค่านั้นมีอยู่ใน enum และ CHECK constraint แต่ไม่มีโค้ดไหน
        //  แยกมันออกจาก viewer เลย — ทุกทางเขียนเช็ค CanEdit()
        //
        //  ประโยชน์ที่ได้: ให้ AI (หรือผู้ตรวจ) รายงานได้แต่แก้เอกสารไม่ได้
        // ─────────────────────────────────────────────────────────────────
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;
        if (!role.Value.CanComment())
        {
            return Error.Forbidden(
                "ต้องมีสิทธิ์แสดงความเห็นขึ้นไปจึงเขียนบันทึกได้", "insufficient_page_role");
        }

        var page = await pages.GetAsync(pageId, ct);
        if (page is null) return PageNotFound;

        var workspaceId = tenant.RequireWorkspaceId();
        var userId = tenant.RequireUserId();

        var note = new PageNote
        {
            Id = Guid.CreateVersion7(),
            WorkspaceId = workspaceId,
            PageId = pageId,
            AuthorUserId = userId,
            Body = body,
            CreatedAt = DateTimeOffset.UtcNow
        };

        // บันทึกกับประวัติต้องเกิดพร้อมกัน ไม่งั้นฟีดกิจกรรมไม่ตรงกับสิ่งที่อยู่ในหน้า
        await notes.AddAsync(note, ActivityEntry.Build(
            workspaceId, pageId, page.Title, userId, ActivityAction.NoteAdded,
            // เก็บตัวอย่างสั้น ๆ ไว้ในประวัติ เพื่อให้ฟีดอ่านรู้เรื่องโดยไม่ต้องดึงบันทึก
            ("preview", Preview(body))), ct);

        logger.LogInformation("เขียนบันทึกบนหน้า {PageId} โดย {UserId}", pageId, userId);

        var rows = await notes.ListAsync(pageId, NoteLimit, ct);
        var saved = rows.FirstOrDefault(r => r.Id == note.Id);

        // ปกติต้องเจอ — เผื่อกรณีที่หาไม่เจอ คืนข้อมูลที่เรามีอยู่แล้วดีกว่าล้ม
        return saved is null
            ? new NoteDto(note.Id, pageId, userId, null, null, body, note.CreatedAt)
            : ToDto(saved);
    }

    public async Task<Result<IReadOnlyList<NoteDto>>> ListNotesAsync(
        Guid pageId, CancellationToken ct = default)
    {
        // อ่านบันทึกต้องมีสิทธิ์เห็นหน้า — viewer อ่านได้ แต่เขียนไม่ได้
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;

        var rows = await notes.ListAsync(pageId, NoteLimit, ct);
        return Result<IReadOnlyList<NoteDto>>.Success([.. rows.Select(ToDto)]);
    }

    public async Task<Result<ActivityFeedDto>> GetActivityAsync(
        Guid? pageId, string? actorKind, DateTimeOffset? since, int? limit,
        CancellationToken ct = default)
    {
        UserKind? wantKind = null;

        if (!string.IsNullOrWhiteSpace(actorKind))
        {
            var normalised = actorKind.Trim().ToLowerInvariant();
            var match = RoleNames.Kinds.FirstOrDefault(kv => kv.Value == normalised);

            if (match.Value is null)
            {
                return Error.Validation(
                    $"ประเภทผู้ทำต้องเป็น {string.Join(" หรือ ", RoleNames.Kinds.Values)}",
                    "invalid_user_kind");
            }

            wantKind = match.Key;
        }

        // ─────────────────────────────────────────────────────────────────
        //  กรองสิทธิ์
        //
        //  ถ้าระบุหน้าเดียว เช็คสิทธิ์หน้านั้นตรง ๆ ซึ่งถูกและถูกที่สุด
        //
        //  ถ้าเป็นฟีดทั้ง workspace: owner/admin เห็นทุกหน้าอยู่แล้ว จึงไม่ต้อง
        //  ส่ง id เป็นพันตัวเข้า query ส่วนคนอื่นต้องจำกัดด้วยรายการหน้าที่เห็นได้
        //  — ยอมจ่ายเป็นการโหลด tree หนึ่งครั้ง ซึ่งเป็นสิ่งที่ sidebar ทำอยู่แล้ว
        // ─────────────────────────────────────────────────────────────────
        if (pageId is { } single)
        {
            var role = await permissions.GetEffectiveRoleAsync(single, ct);
            if (role is null) return PageNotFound;
        }

        IReadOnlyList<Guid>? visiblePageIds = null;

        if (pageId is null && tenant.WorkspaceRole?.IsWorkspaceWideEditor() != true)
        {
            var tree = await pages.ListTreeAsync(ct);
            visiblePageIds = [.. tree.Select(n => n.Id)];

            if (visiblePageIds.Count == 0)
                return new ActivityFeedDto(0, false, []);
        }

        var effectiveLimit = Math.Clamp(limit ?? DefaultActivityLimit, 1, MaxActivityLimit);

        // ขอเกินมาหนึ่งแถวเพื่อรู้ว่ามีมากกว่านั้นจริงไหม โดยไม่ต้อง COUNT ซ้ำ
        var rows = await activity.ListAsync(
            visiblePageIds, pageId, since, effectiveLimit + 1, ct);

        // ⚠️ กรอง actorKind ในหน่วยความจำ ไม่ใช่ใน SQL โดยรู้ตัว
        //    การ join users เข้าไปใน query ทำให้ index (workspace_id, created_at)
        //    ใช้ไม่ได้เต็มที่ และฟีดถูกจำกัดด้วย limit เล็ก ๆ อยู่แล้ว
        //    ผลข้างเคียงที่ยอมรับ: เมื่อกรอง kind จำนวนที่ได้อาจน้อยกว่า limit
        //    ทั้งที่ยังมีแถวเก่ากว่านั้นอยู่ — จึงไม่รายงาน truncated เมื่อกรอง kind
        var filtered = wantKind is null
            ? rows
            : [.. rows.Where(r => r.ActorKind == wantKind)];

        var truncated = wantKind is null && filtered.Count > effectiveLimit;
        if (filtered.Count > effectiveLimit) filtered.RemoveRange(
            effectiveLimit, filtered.Count - effectiveLimit);

        return new ActivityFeedDto(
            filtered.Count,
            truncated,
            [.. filtered.Select(r => new ActivityDto(
                r.Id, r.PageId, r.PageTitle, r.ActorUserId, r.ActorName,
                r.ActorKind?.ToDbValue(), r.Action, r.Detail, r.CreatedAt))]);
    }

    private static NoteDto ToDto(NoteRow row) => new(
        row.Id, row.PageId, row.AuthorUserId, row.AuthorName,
        row.AuthorKind?.ToDbValue(), row.Body, row.CreatedAt);

    /// <summary>ตัวอย่างข้อความสำหรับฟีด — สั้นพอที่จะอ่านผ่าน ๆ ได้</summary>
    private static string Preview(string body)
    {
        const int max = 120;
        var single = body.ReplaceLineEndings(" ");
        return single.Length <= max ? single : $"{single[..max]}…";
    }

    private static Error PageNotFound => Error.NotFound("ไม่พบหน้านี้", "page_not_found");
}
