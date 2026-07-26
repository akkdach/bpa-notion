using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Repositories;

// ═══════════════════════════════════════════════════════════════════════════
//  PageRepository
//
//  งานอ่านใช้ EF (global query filter จำกัด workspace ให้เอง)
//  งานที่แตะ subtree ใช้ raw SQL ผ่าน IScopedSql เพราะต้องใช้ `ancestor_ids @>`
//  ซึ่ง EF แปลไม่ได้ และเพราะต้องเป็น UPDATE เดียวไม่ใช่ loop
//
//  ⚠️ raw SQL ไม่ผ่าน global query filter — ทุก query จึงต้องเขียน
//     `workspace_id = @__ws` เอง (IScopedSql บังคับให้มี ไม่งั้น throw ตอน dev)
//     และต้องเขียน `deleted_at IS NULL` เองด้วยเมื่อไม่ต้องการหน้าที่ถูกลบ
// ═══════════════════════════════════════════════════════════════════════════
public class PageRepository(AppDbContext db, IScopedSql sql) : IPageRepository
{
    public Task<Page?> GetAsync(Guid pageId, CancellationToken ct = default)
        => db.Pages.FirstOrDefaultAsync(p => p.Id == pageId, ct);

    public Task<Page?> GetIncludingDeletedAsync(Guid pageId, CancellationToken ct = default)
        // ปิดเฉพาะ SoftDelete — Tenant filter ยังทำงาน
        => db.Pages
             .IgnoreQueryFilters([AppDbContext.SoftDeleteFilter])
             .FirstOrDefaultAsync(p => p.Id == pageId, ct);

    // ─────────────────────────────────────────────────────────────────────
    //  อ่าน tree
    //
    //  ⚠️ ORDER BY rank, id เสมอ — rank ชนกันได้เมื่อสอง client แทรกที่เดียวกัน
    //     พร้อมกัน id เป็นตัวตัดสินที่ทุก client เห็นตรงกัน
    //     (คอลัมน์ rank เป็น COLLATE "C" แล้ว EF จึงเรียงแบบ byte order ให้เอง)
    // ─────────────────────────────────────────────────────────────────────
    private IQueryable<PageNode> ProjectNodes(IQueryable<Page> query)
        => query
            .OrderBy(p => p.Depth).ThenBy(p => p.Rank).ThenBy(p => p.Id)
            .Select(p => new PageNode(
                p.Id,
                p.ParentId,
                p.Title,
                p.Icon,
                p.Status,
                p.Rank,
                p.Depth,
                p.Kind,
                p.AccessRootId,
                db.Pages.Any(c => c.ParentId == p.Id),
                p.UpdatedAt,
                p.DeletedAt));

    public Task<List<PageNode>> ListChildrenAsync(Guid? parentId, CancellationToken ct = default)
        => ProjectNodes(db.Pages.AsNoTracking().Where(p => p.ParentId == parentId)).ToListAsync(ct);

    public Task<List<PageNode>> ListTreeAsync(CancellationToken ct = default)
        // Phase 1 โหลดทั้ง tree ทีเดียว — workspace ระดับพันหน้ายังไหว
        // เกินกว่านั้นค่อยเปลี่ยนเป็นโหลดทีละชั้นตอนกางโฟลเดอร์
        => ProjectNodes(db.Pages.AsNoTracking().Where(p => p.DatabaseId == null)).ToListAsync(ct);

    public Task<List<PageNode>> ListTrashAsync(CancellationToken ct = default)
        => db.Pages
             .IgnoreQueryFilters([AppDbContext.SoftDeleteFilter])
             .AsNoTracking()
             .Where(p => p.DeletedAt != null)
             .OrderByDescending(p => p.DeletedAt)
             .Select(p => new PageNode(
                 p.Id, p.ParentId, p.Title, p.Icon, p.Status, p.Rank, p.Depth, p.Kind,
                 p.AccessRootId, false, p.UpdatedAt, p.DeletedAt))
             .ToListAsync(ct);

    public async Task<(string? Before, string? After)> GetNeighbourRanksAsync(
        Guid? parentId, Guid? afterPageId, CancellationToken ct = default)
    {
        var siblings = await db.Pages.AsNoTracking()
            .Where(p => p.ParentId == parentId)
            .OrderBy(p => p.Rank).ThenBy(p => p.Id)
            .Select(p => new { p.Id, p.Rank })
            .ToListAsync(ct);

        if (siblings.Count == 0) return (null, null);

        // ไม่ระบุตำแหน่ง = ต่อท้าย
        if (afterPageId is null) return (siblings[^1].Rank, null);

        var index = siblings.FindIndex(s => s.Id == afterPageId);

        // ระบุหน้าที่ไม่ได้อยู่ในกลุ่มพี่น้องนี้ — ถือว่าต่อท้าย
        if (index < 0) return (siblings[^1].Rank, null);

        return (siblings[index].Rank,
                index + 1 < siblings.Count ? siblings[index + 1].Rank : null);
    }

    public async Task<Page> AddAsync(Page page, CancellationToken ct = default)
    {
        db.Pages.Add(page);
        await db.SaveChangesAsync(ct);
        return page;
    }

    public Task UpdateTitleAsync(
        Guid pageId, string title, Guid editorId, CancellationToken ct = default)
        => db.Pages
             .Where(p => p.Id == pageId)
             .ExecuteUpdateAsync(s => s
                 .SetProperty(p => p.Title, title)
                 .SetProperty(p => p.LastEditedBy, editorId)
                 .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), ct);

    public Task UpdateIconAsync(
        Guid pageId, string? icon, string? coverUrl, CancellationToken ct = default)
        => db.Pages
             .Where(p => p.Id == pageId)
             .ExecuteUpdateAsync(s => s
                 .SetProperty(p => p.Icon, icon)
                 .SetProperty(p => p.CoverUrl, coverUrl)
                 .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), ct);

    public Task UpdateStatusAsync(
        Guid pageId, string? status, Guid editorId, CancellationToken ct = default)
        => db.Pages
             .Where(p => p.Id == pageId)
             .ExecuteUpdateAsync(s => s
                 .SetProperty(p => p.Status, status)
                 .SetProperty(p => p.LastEditedBy, editorId)
                 .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), ct);

    // ═══════════════════════════════════════════════════════════════════════
    //  ย้าย subtree — UPDATE เดียวสำหรับลูกหลานทั้งหมด
    //
    //  หัวใจอยู่ที่ `ancestor_ids @> ARRAY[@pageId]` ซึ่งวิ่งบน GIN index
    //  ทำให้ย้ายหน้าที่มีลูกหลาน 500 หน้าเป็น statement เดียว ไม่ใช่ recursion
    //
    //  การตัดสตริง: ลูกหลานมี ancestor_ids = [บรรพบุรุษเดิมของหน้าที่ย้าย …,
    //  หน้าที่ย้าย, …ต่อไป] เราแทนที่ "ส่วนหน้า" ที่ยาวเท่ากับ depth เดิม
    //  ด้วยชุดใหม่ แล้วเก็บส่วนที่เหลือ (ซึ่งเริ่มด้วยตัวหน้าที่ย้ายเอง) ไว้
    // ═══════════════════════════════════════════════════════════════════════
    public Task<int> MoveSubtreeAsync(MoveSubtreeCommand command, CancellationToken ct = default)
        => db.InTransactionAsync(async token =>
        {
            // 1) ตัวหน้าที่ถูกย้ายเอง
            await sql.ExecuteAsync("""
                UPDATE pages
                   SET parent_id      = @parentId,
                       ancestor_ids   = @newAncestors,
                       depth          = cardinality(@newAncestors),
                       rank           = @rank,
                       access_root_id = @newRoot,
                       updated_at     = now()
                 WHERE workspace_id = @__ws
                   AND id = @pageId
                """,
                p =>
                {
                    p.Add(new NpgsqlParameter("pageId", NpgsqlDbType.Uuid) { Value = command.PageId });
                    p.Add(new NpgsqlParameter("parentId", NpgsqlDbType.Uuid)
                    {
                        Value = (object?)command.NewParentId ?? DBNull.Value
                    });
                    p.Add(new NpgsqlParameter("newAncestors", NpgsqlDbType.Array | NpgsqlDbType.Uuid)
                    {
                        Value = command.NewAncestorIds
                    });
                    p.Add(new NpgsqlParameter("rank", NpgsqlDbType.Varchar) { Value = command.NewRank });
                    p.Add(new NpgsqlParameter("newRoot", NpgsqlDbType.Uuid) { Value = command.NewAccessRootId });
                }, token);

            // 2) ลูกหลานทั้งหมด — statement เดียว
            return await sql.ExecuteAsync("""
                UPDATE pages
                   SET ancestor_ids   = @newAncestors || ancestor_ids[@oldDepth + 1 : ],
                       depth          = depth + (cardinality(@newAncestors) - @oldDepth),
                       access_root_id = CASE
                                            WHEN access_root_id = @oldRoot THEN @newRoot
                                            ELSE access_root_id
                                        END,
                       updated_at     = now()
                 WHERE workspace_id = @__ws
                   AND ancestor_ids @> ARRAY[@pageId]::uuid[]
                """,
                p =>
                {
                    p.Add(new NpgsqlParameter("pageId", NpgsqlDbType.Uuid) { Value = command.PageId });
                    p.Add(new NpgsqlParameter("newAncestors", NpgsqlDbType.Array | NpgsqlDbType.Uuid)
                    {
                        Value = command.NewAncestorIds
                    });
                    p.Add(new NpgsqlParameter("oldDepth", NpgsqlDbType.Integer) { Value = command.OldDepth });
                    p.Add(new NpgsqlParameter("oldRoot", NpgsqlDbType.Uuid) { Value = command.OldAccessRootId });
                    p.Add(new NpgsqlParameter("newRoot", NpgsqlDbType.Uuid) { Value = command.NewAccessRootId });
                }, token);
        }, ct);

    // ═══════════════════════════════════════════════════════════════════════
    //  ลบ / กู้คืน — ทำกับ subtree ทั้งก้อนเสมอ
    // ═══════════════════════════════════════════════════════════════════════

    public Task<int> SoftDeleteSubtreeAsync(Guid pageId, CancellationToken ct = default)
        => sql.ExecuteAsync("""
            UPDATE pages
               SET deleted_at = now(), updated_at = now()
             WHERE workspace_id = @__ws
               AND deleted_at IS NULL
               AND (id = @pageId OR ancestor_ids @> ARRAY[@pageId]::uuid[])
            """,
            p => p.Add(new NpgsqlParameter("pageId", NpgsqlDbType.Uuid) { Value = pageId }), ct);

    public Task<int> RestoreSubtreeAsync(Guid pageId, CancellationToken ct = default)
        // ⚠️ กู้คืนได้เฉพาะเมื่อ parent ยังอยู่ ไม่งั้นจะได้หน้ากำพร้าที่มองไม่เห็น
        //    ใน sidebar (parent_id ชี้ไปหน้าที่ยังอยู่ในถังขยะ)
        => sql.ExecuteAsync("""
            UPDATE pages
               SET deleted_at = NULL, updated_at = now()
             WHERE workspace_id = @__ws
               AND deleted_at IS NOT NULL
               AND (id = @pageId OR ancestor_ids @> ARRAY[@pageId]::uuid[])
            """,
            p => p.Add(new NpgsqlParameter("pageId", NpgsqlDbType.Uuid) { Value = pageId }), ct);

    public Task<int> PurgeSubtreeAsync(Guid pageId, CancellationToken ct = default)
        // page_doc_updates / page_doc_snapshots / page_searches หายตาม
        // ด้วย ON DELETE CASCADE ของ composite FK
        => sql.ExecuteAsync("""
            DELETE FROM pages
             WHERE workspace_id = @__ws
               AND (id = @pageId OR ancestor_ids @> ARRAY[@pageId]::uuid[])
            """,
            p => p.Add(new NpgsqlParameter("pageId", NpgsqlDbType.Uuid) { Value = pageId }), ct);

    // ═══════════════════════════════════════════════════════════════════════
    //  ACL
    // ═══════════════════════════════════════════════════════════════════════

    public Task<bool> HasOwnAclAsync(Guid pageId, CancellationToken ct = default)
        => db.PageAcls.AnyAsync(a => a.PageId == pageId, ct);

    public async Task AddAclAsync(PageAcl acl, CancellationToken ct = default)
    {
        db.PageAcls.Add(acl);
        await db.SaveChangesAsync(ct);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Repair
    //
    //  ancestor_ids และ access_root_id เป็นค่า denormalise ที่ "เพี้ยนได้"
    //  โดยเฉพาะ access_root_id ซึ่งถ้าเพี้ยนแปลว่าเป็นบั๊กเรื่องสิทธิ์
    //  จึงต้องมีทางซ่อมและทางตรวจตั้งแต่วันแรก ไม่ใช่ไปเขียนตอนเกิดเรื่อง
    // ═══════════════════════════════════════════════════════════════════════

    public Task<int> RebuildAncestorIdsAsync(CancellationToken ct = default)
        // parent_id คือความจริง (มี FK บังคับ) — สร้าง ancestor_ids ใหม่จากมัน
        => sql.ExecuteAsync("""
            WITH RECURSIVE tree AS (
                SELECT id, ARRAY[]::uuid[] AS ancestors, 0 AS depth
                  FROM pages
                 WHERE workspace_id = @__ws AND parent_id IS NULL
                UNION ALL
                SELECT p.id, t.ancestors || p.parent_id, t.depth + 1
                  FROM pages p
                  JOIN tree t ON p.parent_id = t.id
                 WHERE p.workspace_id = @__ws
            )
            UPDATE pages
               SET ancestor_ids = t.ancestors, depth = t.depth
              FROM tree t
             WHERE pages.id = t.id
               AND pages.workspace_id = @__ws
               AND (pages.ancestor_ids IS DISTINCT FROM t.ancestors
                    OR pages.depth IS DISTINCT FROM t.depth)
            """, null, ct);

    public Task<int> RecomputeAccessRootsAsync(CancellationToken ct = default)
        // access root = ancestor-or-self ที่ใกล้ที่สุดซึ่งมีแถวใน page_acls
        // ancestor_ids เรียงจาก root ไป parent จึงเอา ordinal มากสุดที่มี ACL
        => sql.ExecuteAsync("""
            WITH acl_owner AS (
                SELECT DISTINCT page_id FROM page_acls WHERE workspace_id = @__ws
            ),
            resolved AS (
                SELECT p.id,
                       COALESCE(
                           (SELECT p.id WHERE EXISTS (
                                SELECT 1 FROM acl_owner o WHERE o.page_id = p.id)),
                           (SELECT u.a
                              FROM unnest(p.ancestor_ids) WITH ORDINALITY AS u(a, ord)
                              JOIN acl_owner o ON o.page_id = u.a
                             ORDER BY u.ord DESC
                             LIMIT 1),
                           p.ancestor_ids[1],
                           p.id
                       ) AS access_root_id
                  FROM pages p
                 WHERE p.workspace_id = @__ws
            )
            UPDATE pages
               SET access_root_id = r.access_root_id
              FROM resolved r
             WHERE pages.id = r.id
               AND pages.workspace_id = @__ws
               AND pages.access_root_id IS DISTINCT FROM r.access_root_id
            """, null, ct);

    public async Task<TreeConsistency> CheckConsistencyAsync(CancellationToken ct = default)
    {
        var result = await sql.QuerySingleAsync("""
            WITH RECURSIVE tree AS (
                SELECT id, ARRAY[]::uuid[] AS ancestors, 0 AS depth
                  FROM pages WHERE workspace_id = @__ws AND parent_id IS NULL
                UNION ALL
                SELECT p.id, t.ancestors || p.parent_id, t.depth + 1
                  FROM pages p JOIN tree t ON p.parent_id = t.id
                 WHERE p.workspace_id = @__ws
            ),
            acl_owner AS (
                SELECT DISTINCT page_id FROM page_acls WHERE workspace_id = @__ws
            ),
            expected_root AS (
                SELECT p.id,
                       COALESCE(
                           (SELECT p.id WHERE EXISTS (
                                SELECT 1 FROM acl_owner o WHERE o.page_id = p.id)),
                           (SELECT u.a FROM unnest(p.ancestor_ids) WITH ORDINALITY AS u(a, ord)
                              JOIN acl_owner o ON o.page_id = u.a
                             ORDER BY u.ord DESC LIMIT 1),
                           p.ancestor_ids[1],
                           p.id
                       ) AS root
                  FROM pages p WHERE p.workspace_id = @__ws
            )
            SELECT
                (SELECT count(*) FROM pages p JOIN tree t ON t.id = p.id
                  WHERE p.workspace_id = @__ws
                    AND (p.ancestor_ids IS DISTINCT FROM t.ancestors
                         OR p.depth IS DISTINCT FROM t.depth))::int,
                (SELECT count(*) FROM pages p JOIN expected_root e ON e.id = p.id
                  WHERE p.workspace_id = @__ws
                    AND p.access_root_id IS DISTINCT FROM e.root)::int,
                (SELECT count(*) FROM pages p
                  WHERE p.workspace_id = @__ws
                    AND p.parent_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM tree t WHERE t.id = p.id))::int
            """,
            reader => new TreeConsistency(reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2)),
            null, ct);

        return result ?? new TreeConsistency(0, 0, 0);
    }
}
