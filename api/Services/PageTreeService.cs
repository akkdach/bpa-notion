using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Mapping;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  PageTreeService
//
//  ดูแลค่าที่ denormalise ไว้สามตัวให้ตรงกันเสมอ:
//    · ancestor_ids  — root..parent (มี GIN index) ทำให้งาน subtree เป็น
//                      UPDATE เดียว และ breadcrumb เป็น query เดียว
//    · depth         — cardinality(ancestor_ids) มี CHECK constraint บังคับ
//    · access_root_id — ancestor-or-self ที่ใกล้สุดซึ่งมี ACL ของตัวเอง
//                      ทำให้ตรวจสิทธิ์เป็น query เดียวที่ความลึกคงที่
//
//  ⚠️ access_root_id เพี้ยน = บั๊กเรื่องสิทธิ์ ซึ่งเป็นบั๊กที่แย่ที่สุด
//     จึงมี CheckConsistencyAsync/RepairAsync มาตั้งแต่ต้น และควรตั้งให้รัน
//     ตรวจทุกวันในช่วงเดือนแรก ๆ
// ═══════════════════════════════════════════════════════════════════════════
public class PageTreeService(
    IPageRepository pages,
    IPermissionService permissions,
    ITenantContext tenant,
    ILogger<PageTreeService> logger) : IPageTreeService
{
    public async Task<Result<List<PageNodeDto>>> GetTreeAsync(CancellationToken ct = default)
    {
        var nodes = await pages.ListTreeAsync(ct);

        // owner/admin เห็นทุกหน้า — ข้ามการกรองไปเลย
        if (tenant.WorkspaceRole?.IsWorkspaceWideEditor() == true)
        {
            return nodes.Select(n => n.ToNodeDto()).ToList();
        }

        // กรองด้วย access root ที่มองเห็น — เซ็ตเดียวใช้ได้ทั้ง tree
        // ไม่ต้องถามสิทธิ์ทีละหน้า
        var visible = (await permissions.GetVisibleAccessRootsAsync(ct)).ToHashSet();

        return nodes.Where(n => visible.Contains(n.AccessRootId))
                    .Select(n => n.ToNodeDto())
                    .ToList();
    }

    public async Task<Result<PageDto>> GetAsync(Guid pageId, CancellationToken ct = default)
    {
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;

        var page = await pages.GetAsync(pageId, ct);
        return page is null ? PageNotFound : page.ToDto(role.Value);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  สร้าง
    // ═══════════════════════════════════════════════════════════════════════
    public async Task<Result<PageDto>> CreateAsync(
        CreatePageRequest request, CancellationToken ct = default)
    {
        var workspaceId = tenant.RequireWorkspaceId();
        var userId = tenant.RequireUserId();

        // ตรวจสถานะก่อนแตะฐาน — ไม่งั้นค่าผิดจะทิ้งหน้าเปล่าไว้ในระบบ
        string? status = null;
        if (request.Status is not null)
        {
            var parsed = ParseStatus(request.Status);
            if (parsed.IsFailure) return parsed.Error;
            status = parsed.Value;
        }

        Page? parent = null;

        if (request.ParentId is { } parentId)
        {
            // ต้องมีสิทธิ์ "แก้" ที่ parent ถึงจะสร้างลูกใต้มันได้
            var parentRole = await permissions.GetEffectiveRoleAsync(parentId, ct);
            if (parentRole is null) return PageNotFound;
            if (!parentRole.Value.CanEdit()) return NoEditPermission;

            parent = await pages.GetAsync(parentId, ct);
            if (parent is null) return PageNotFound;
        }
        else if (tenant.WorkspaceRole == WorkspaceRole.Guest)
        {
            // guest สร้างหน้าระดับบนสุดไม่ได้ — จะกลายเป็นหน้าที่ไม่มีใครเห็น
            return Error.Forbidden("guest สร้างหน้าระดับบนสุดไม่ได้", "insufficient_role");
        }

        var (before, after) = await pages.GetNeighbourRanksAsync(
            request.ParentId, request.AfterPageId, ct);

        var page = new Page
        {
            Id = Guid.CreateVersion7(),
            WorkspaceId = workspaceId,
            ParentId = request.ParentId,
            AncestorIds = parent is null ? [] : [.. parent.AncestorIds, parent.Id],
            Depth = parent is null ? 0 : parent.Depth + 1,
            Rank = FractionalIndex.Between(before, after),
            Kind = PageKind.Page,
            Title = request.Title?.Trim() ?? string.Empty,
            Icon = request.Icon,
            Status = status,
            CreatedBy = userId,
            LastEditedBy = userId,

            // หน้าระดับบนสุดเป็น access root ของตัวเอง ส่วนหน้าลูกสืบทอดจากพ่อ
            AccessRootId = parent?.AccessRootId ?? Guid.Empty
        };

        if (parent is null) page.AccessRootId = page.Id;

        // ─────────────────────────────────────────────────────────────────
        //  หน้าระดับบนสุดต้องมี ACL ของตัวเอง ไม่งั้นมันจะเป็น access root
        //  ที่ไม่มี grant ใด ๆ = ไม่มีใครเห็นเลย รวมทั้งคนสร้าง
        //  (owner/admin ยังเห็นเพราะ short-circuit แต่ member จะไม่เห็น)
        //
        //  ส่งเข้าไปให้ AddAsync เขียนในธุรกรรมเดียวกับตัวหน้า — ถ้า commit แยกกัน
        //  แล้ว ACL ล้ม จะเหลือหน้าที่ไม่มีใครเห็นและแก้จากหน้าเว็บไม่ได้
        // ─────────────────────────────────────────────────────────────────
        var acl = parent is null
            ? PageAcl.ForWorkspace(workspaceId, page.Id, PageRole.Editor, userId)
            : null;

        var activity = ActivityEntry.Build(
            workspaceId, page.Id, page.Title, userId, ActivityAction.PageCreated,
            ("parentId", page.ParentId),
            ("status", ActivityEntry.StatusOrNone(page.Status)));

        await pages.AddAsync(page, acl, activity, ct);

        logger.LogInformation(
            "สร้างหน้า {PageId} ใต้ {ParentId} depth={Depth}",
            page.Id, page.ParentId, page.Depth);

        return page.ToDto(PageRole.Full);
    }

    public async Task<Result<PageDto>> UpdateAsync(
        Guid pageId, UpdatePageRequest request, CancellationToken ct = default)
    {
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;
        if (!role.Value.CanEdit()) return NoEditPermission;

        var page = await pages.GetAsync(pageId, ct);
        if (page is null) return PageNotFound;

        var userId = tenant.RequireUserId();
        var workspaceId = tenant.RequireWorkspaceId();

        // ─────────────────────────────────────────────────────────────────
        //  ตรวจสถานะก่อนเขียนอะไรเลย
        //
        //  ⚠️ ลำดับนี้สำคัญ: คำขอเดียวเปลี่ยนได้หลายอย่าง และแต่ละอย่างเป็น
        //     ธุรกรรมของตัวเอง ถ้า validate สถานะทีหลังแล้วมันผิด ชื่อกับไอคอน
        //     จะถูกเขียนไปแล้วทั้งที่คำขอตอบ 400 = แก้ไปครึ่ง ๆ กลาง ๆ
        // ─────────────────────────────────────────────────────────────────
        string? newStatus = null;
        if (request.Status is not null)
        {
            var parsed = ParseStatus(request.Status);
            if (parsed.IsFailure) return parsed.Error;
            newStatus = parsed.Value;
        }

        if (request.Title is not null)
        {
            var title = request.Title.Trim();

            await pages.UpdateTitleAsync(pageId, title, userId,
                ActivityEntry.Build(workspaceId, pageId, title, userId,
                    ActivityAction.PageRenamed,
                    ("from", page.Title), ("to", title)), ct);

            page.Title = title;
        }

        if (request.Icon is not null || request.CoverUrl is not null)
        {
            await pages.UpdateIconAsync(pageId, request.Icon, request.CoverUrl, userId,
                ActivityEntry.Build(workspaceId, pageId, page.Title, userId,
                    ActivityAction.IconChanged,
                    ("from", page.Icon), ("to", request.Icon)), ct);

            page.Icon = request.Icon;
            page.CoverUrl = request.CoverUrl;
        }

        // สถานะงาน — "" (สตริงว่าง) = ล้างสถานะ, null = ไม่แตะ
        if (request.Status is not null)
        {
            // เขียนประวัติเฉพาะเมื่อค่าเปลี่ยนจริง — การกด chip วนกลับมาที่เดิม
            // หรือ client ส่งค่าซ้ำ ไม่ควรทำให้ฟีดกิจกรรมเต็มไปด้วยแถวที่ไม่มีอะไรเกิด
            var changed = page.Status != newStatus;

            await pages.UpdateStatusAsync(pageId, newStatus, userId,
                changed
                    ? ActivityEntry.Build(workspaceId, pageId, page.Title, userId,
                        ActivityAction.StatusChanged,
                        ("from", ActivityEntry.StatusOrNone(page.Status)),
                        ("to", ActivityEntry.StatusOrNone(newStatus)))
                    : null,
                ct);

            page.Status = newStatus;
        }

        return page.ToDto(role.Value);
    }

    /// <summary>
    /// ตรวจและ normalise สถานะที่ผู้เรียกส่งมา — คืน null เมื่อเป็นสตริงว่าง (ล้างสถานะ)
    /// </summary>
    /// <remarks>
    /// แยกออกมาเพราะทั้ง CreateAsync และ UpdateAsync ต้องใช้กฎเดียวกัน
    /// ฐานข้อมูลมี ck_pages_status กันไว้อีกชั้น แต่ที่นี่คือชั้นที่ตอบผู้เรียกได้ว่า
    /// ค่าที่ถูกต้องมีอะไร — constraint ฝั่งฐานจะได้เป็น 500 ไม่ใช่ 400
    /// </remarks>
    private static Result<string?> ParseStatus(string status)
    {
        var normalised = status.Trim().ToLowerInvariant();

        if (normalised.Length == 0) return Result<string?>.Success(null);
        if (PageStatus.IsValid(normalised)) return Result<string?>.Success(normalised);

        return Error.Validation(
            $"สถานะต้องเป็นหนึ่งใน: {PageStatus.Listed} (หรือค่าว่างเพื่อล้าง)",
            "invalid_status");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ย้าย
    // ═══════════════════════════════════════════════════════════════════════
    public async Task<Result<MoveResultDto>> MoveAsync(
        Guid pageId, MovePageRequest request, CancellationToken ct = default)
    {
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;
        if (!role.Value.CanEdit()) return NoEditPermission;

        var page = await pages.GetAsync(pageId, ct);
        if (page is null) return PageNotFound;

        Page? newParent = null;

        if (request.ParentId is { } newParentId)
        {
            if (newParentId == pageId)
            {
                return Error.Validation("ย้ายหน้าไปไว้ใต้ตัวเองไม่ได้", "cycle");
            }

            var parentRole = await permissions.GetEffectiveRoleAsync(newParentId, ct);
            if (parentRole is null) return PageNotFound;
            if (!parentRole.Value.CanEdit()) return NoEditPermission;

            newParent = await pages.GetAsync(newParentId, ct);
            if (newParent is null) return PageNotFound;

            // ─────────────────────────────────────────────────────────────
            //  กันวงกลม: parent ใหม่ต้องไม่ใช่ลูกหลานของหน้าที่กำลังย้าย
            //  เช็คได้ด้วยการดูว่า pageId อยู่ใน ancestor_ids ของ parent ใหม่
            //  ไหม — ไม่ต้องไล่ tree เลย
            //
            //  ถ้าปล่อยผ่าน จะได้ subtree ที่หลุดออกจาก tree ไปเลย (parent
            //  ชี้กันเป็นวง) แล้ว recursive CTE ตอนซ่อมจะวนไม่จบ
            // ─────────────────────────────────────────────────────────────
            if (newParent.AncestorIds.Contains(pageId))
            {
                return Error.Validation(
                    "ย้ายหน้าไปไว้ใต้ลูกหลานของตัวเองไม่ได้", "cycle");
            }
        }
        else if (tenant.WorkspaceRole == WorkspaceRole.Guest)
        {
            return Error.Forbidden("guest ย้ายหน้าขึ้นระดับบนสุดไม่ได้", "insufficient_role");
        }

        var (before, after) = await pages.GetNeighbourRanksAsync(
            request.ParentId, request.AfterPageId, ct);

        var newAncestors = newParent is null
            ? Array.Empty<Guid>()
            : [.. newParent.AncestorIds, newParent.Id];

        // ─────────────────────────────────────────────────────────────────
        //  access root ใหม่
        //
        //  ถ้าหน้านี้มี ACL ของตัวเอง มันเป็น access root อยู่แล้ว การย้ายไม่
        //  เปลี่ยนอะไร ลูกหลานยังชี้มาที่มันเหมือนเดิม
        //
        //  ถ้าไม่มี มันสืบทอดจาก parent — ย้ายแล้วต้องเปลี่ยนตาม และลูกหลาน
        //  ที่เคยชี้ที่ root เดิมต้องเปลี่ยนตามไปด้วย (ทำใน UPDATE เดียวกัน)
        // ─────────────────────────────────────────────────────────────────
        var hasOwnAcl = await pages.HasOwnAclAsync(pageId, ct);

        var newAccessRoot = hasOwnAcl
            ? pageId
            : newParent?.AccessRootId ?? pageId;

        // ย้ายขึ้นระดับบนสุดโดยไม่มี ACL ของตัวเอง = จะกลายเป็น access root
        // ที่ไม่มี grant ต้องสร้าง ACL ให้เหมือนตอนสร้างหน้าใหม่
        //
        // ⚠️ ประกอบไว้เฉย ๆ แล้วส่งให้ MoveSubtreeAsync เขียนในธุรกรรมเดียวกับการย้าย
        //    ห้ามเรียก AddAclAsync ที่นี่ — มัน commit ทันที ถ้าการย้ายล้มทีหลัง
        //    หน้านั้นจะเหลือ ACL แบบ workspace-wide Editor ค้างอยู่ทั้งที่ไม่ได้ย้าย
        //    = ทุกคนใน workspace แก้หน้านั้นได้โดยไม่มีใครสั่ง
        var aclToAdd = newParent is null && !hasOwnAcl
            ? PageAcl.ForWorkspace(
                tenant.RequireWorkspaceId(), pageId, PageRole.Editor, tenant.RequireUserId())
            : null;

        var affected = await pages.MoveSubtreeAsync(new MoveSubtreeCommand(
            PageId: pageId,
            NewParentId: request.ParentId,
            NewAncestorIds: newAncestors,
            OldDepth: page.Depth,
            NewRank: FractionalIndex.Between(before, after),
            OldAccessRootId: page.AccessRootId,
            NewAccessRootId: newAccessRoot),
            aclToAdd,
            ActivityEntry.Build(
                tenant.RequireWorkspaceId(), pageId, page.Title, tenant.RequireUserId(),
                ActivityAction.PageMoved,
                ("fromParentId", page.ParentId), ("toParentId", request.ParentId)),
            ct);

        logger.LogInformation(
            "ย้ายหน้า {PageId} จาก depth {OldDepth} ไป {NewDepth} — ลูกหลาน {Affected} หน้า",
            pageId, page.Depth, newAncestors.Length, affected);

        var moved = await pages.GetAsync(pageId, ct);
        if (moved is null) return PageNotFound;

        return new MoveResultDto(moved.ToDto(role.Value), affected);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ลบ / กู้คืน
    // ═══════════════════════════════════════════════════════════════════════
    public async Task<Result<int>> DeleteAsync(Guid pageId, CancellationToken ct = default)
    {
        var role = await permissions.GetEffectiveRoleAsync(pageId, ct);
        if (role is null) return PageNotFound;
        if (!role.Value.CanEdit()) return NoEditPermission;

        // อ่านชื่อไว้ก่อนลบ — เก็บลงประวัติเพื่อให้ตอบได้ว่า "ใครลบหน้าชื่ออะไร"
        // แม้หน้านั้นจะถูกลบถาวรไปแล้วในภายหลัง
        var page = await pages.GetAsync(pageId, ct);
        if (page is null) return PageNotFound;

        var affected = await pages.SoftDeleteSubtreeAsync(pageId,
            ActivityEntry.Build(
                tenant.RequireWorkspaceId(), pageId, page.Title, tenant.RequireUserId(),
                ActivityAction.PageDeleted,
                ("status", ActivityEntry.StatusOrNone(page.Status))), ct);

        logger.LogInformation("ลบหน้า {PageId} พร้อมลูกหลาน รวม {Affected} หน้า", pageId, affected);

        return affected;
    }

    public async Task<Result<int>> RestoreAsync(Guid pageId, CancellationToken ct = default)
    {
        var page = await pages.GetIncludingDeletedAsync(pageId, ct);
        if (page is null) return PageNotFound;

        // ⚠️ ต้องเช็คสิทธิ์ที่ access root "ซึ่งถูกลบไปด้วยแล้ว" — ใช้ตัวปกติไม่ได้
        //    เพราะ SoftDeleteFilter ตัดหน้าออกก่อน แล้วทุกคนที่ไม่ใช่ owner/admin
        //    จะได้ null = ไม่มีสิทธิ์ เสมอ
        //
        //    อาการตอนนั้น: สมาชิกลบหน้าของตัวเอง เห็นมันอยู่ในถังขยะ กดกู้คืน
        //    แล้วได้ 404 "ไม่พบหน้านี้" ทั้งที่เพิ่งเห็นมันอยู่
        if (tenant.WorkspaceRole?.IsWorkspaceWideEditor() != true)
        {
            var role = await permissions.GetEffectiveRoleForDeletedAsync(page.AccessRootId, ct);
            if (role is null || !role.Value.CanEdit()) return PageNotFound;
        }

        // กู้คืนหน้าที่ parent ยังอยู่ในถังขยะ = ได้หน้ากำพร้าที่ไม่โผล่ใน
        // sidebar เพราะ parent มองไม่เห็น — ต้องกู้จากบนลงล่าง
        if (page.ParentId is { } parentId)
        {
            var parent = await pages.GetIncludingDeletedAsync(parentId, ct);
            if (parent?.DeletedAt is not null)
            {
                return Error.Conflict(
                    "หน้าแม่ยังอยู่ในถังขยะ — กู้คืนหน้าแม่ก่อน",
                    "parent_still_deleted");
            }
        }

        // ⚠️ ประวัติไม่เก็บชุด deleted_at เดิมของลูกหลาน จึง "ย้อน restore ไม่ได้"
        //    RestoreSubtreeAsync กู้ทั้ง subtree แบบไม่มีเงื่อนไข รวมลูกที่ถูกลบไป
        //    ก่อนหน้านั้นแล้ว — การลบซ้ำจึงกู้ความต่างนั้นคืนไม่ได้
        //    ปุ่มย้อนกลับบนฟีดกิจกรรมจึงรองรับแค่การเปลี่ยนสถานะ (ดู S5 ในแผน)
        var affected = await pages.RestoreSubtreeAsync(pageId,
            ActivityEntry.Build(
                tenant.RequireWorkspaceId(), pageId, page.Title, tenant.RequireUserId(),
                ActivityAction.PageRestored), ct);

        return affected;
    }

    public async Task<Result<int>> PurgeAsync(Guid pageId, CancellationToken ct = default)
    {
        // ลบถาวรเป็นงานของ owner/admin เท่านั้น — ย้อนกลับไม่ได้
        if (tenant.WorkspaceRole?.IsWorkspaceWideEditor() != true)
        {
            return Error.Forbidden("ต้องเป็น owner หรือ admin เท่านั้น", "insufficient_role");
        }

        var page = await pages.GetIncludingDeletedAsync(pageId, ct);
        if (page is null) return PageNotFound;

        if (page.DeletedAt is null)
        {
            return Error.Conflict("ต้องย้ายไปถังขยะก่อนจึงจะลบถาวรได้", "not_deleted");
        }

        var affected = await pages.PurgeSubtreeAsync(pageId, ct);

        logger.LogWarning("ลบถาวร {PageId} พร้อมลูกหลาน รวม {Affected} หน้า", pageId, affected);

        return affected;
    }

    public async Task<Result<List<PageNodeDto>>> GetTrashAsync(CancellationToken ct = default)
    {
        var nodes = await pages.ListTrashAsync(ct);
        return nodes.Select(n => n.ToNodeDto()).ToList();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Repair
    // ═══════════════════════════════════════════════════════════════════════

    public async Task<Result<TreeConsistency>> CheckConsistencyAsync(
        CancellationToken ct = default)
    {
        if (tenant.WorkspaceRole?.IsWorkspaceWideEditor() != true)
        {
            return Error.Forbidden("ต้องเป็น owner หรือ admin เท่านั้น", "insufficient_role");
        }

        return await pages.CheckConsistencyAsync(ct);
    }

    public async Task<Result<RepairResultDto>> RepairAsync(CancellationToken ct = default)
    {
        if (tenant.WorkspaceRole?.IsWorkspaceWideEditor() != true)
        {
            return Error.Forbidden("ต้องเป็น owner หรือ admin เท่านั้น", "insufficient_role");
        }

        // ลำดับสำคัญ: access_root_id คำนวณจาก ancestor_ids จึงต้องซ่อม
        // ancestor_ids ให้ถูกก่อน
        var fixedAncestors = await pages.RebuildAncestorIdsAsync(ct);
        var fixedRoots = await pages.RecomputeAccessRootsAsync(ct);

        if (fixedAncestors > 0 || fixedRoots > 0)
        {
            logger.LogWarning(
                "ซ่อม tree ของ workspace {WorkspaceId}: ancestor_ids {Ancestors} แถว, " +
                "access_root_id {Roots} แถว — ควรหาสาเหตุว่าเพี้ยนตอนไหน",
                tenant.WorkspaceId, fixedAncestors, fixedRoots);
        }

        return new RepairResultDto(fixedAncestors, fixedRoots);
    }

    private static Error PageNotFound => Error.NotFound("ไม่พบหน้านี้", "page_not_found");

    private static Error NoEditPermission =>
        Error.Forbidden("ไม่มีสิทธิ์แก้ไขหน้านี้", "insufficient_page_role");
}
