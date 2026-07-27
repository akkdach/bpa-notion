using System.ComponentModel;
using System.Text;
using ModelContextProtocol.Server;

namespace ProjectManagementMcp;

// ═══════════════════════════════════════════════════════════════════════════
//  Tools ที่ Claude Code เรียกได้
//
//  โมเดล: โปรเจกต์ = หน้าระดับบนสุด, งาน = หน้าลูกที่มีสถานะ
//  สถานะเก็บในคอลัมน์ status ของ pages (todo / doing / done, null = ไม่ใช่งาน)
//
//  ⚠️ จำนวน tool ถูกคุมไว้โดยเจตนา — schema ของทุกตัวอยู่ใน system prompt ของ
//     ทุก session ในโฟลเดอร์นี้ตลอดไป ไม่ว่า session นั้นจะเกี่ยวกับแอปนี้หรือไม่
//     และ tool ที่คล้ายกันหลายตัวทำให้โมเดลเลือกผิดบ่อยขึ้น
//
//     จึงรวมด้วยพารามิเตอร์แทนการแตกเป็นหลายตัว:
//       find_pages   แทน list_projects + list_tasks + ค้นหา + ดูถังขยะ
//       get_page     แทน get_task + อ่านเนื้อหา
//       create_page  แทน create_project + create_task (ต่างกันแค่ parent_id)
//       update_page  แทน update_task + complete_task + ย้ายหน้า
//
//     ⚠️ ไม่มี purge (ลบถาวร) ให้ AI โดยเจตนา — การลบที่ย้อนไม่ได้ไม่ใช่สิ่งที่
//        AI ต้องทำได้ เจ้าของทำเองจากหน้าถังขยะบนเว็บ
// ═══════════════════════════════════════════════════════════════════════════
[McpServerToolType]
public static class TaskTools
{
    /// <summary>จำนวนผลลัพธ์เริ่มต้น — มากกว่านี้ AI มักอ่านไม่ครบและเปลือง context</summary>
    private const int DefaultLimit = 25;

    private static string Emoji(string? status) => status switch
    {
        "todo" => "⬜",
        "doing" => "🔄",
        "done" => "✅",
        _ => "▫️"
    };

    /// <summary>
    /// normalise เท่านั้น — ไม่ตรวจว่าค่าถูกต้อง
    /// </summary>
    /// <remarks>
    /// เดิมมีรายการสถานะที่อนุญาตสำเนาไว้ที่นี่ด้วย ตัดออกแล้วโดยเจตนา:
    /// ฐานข้อมูลมี ck_pages_status, API มี PageStatus.All ที่ validate และตอบ 400
    /// พร้อมรายการค่าที่ถูกต้องกลับมา สำเนาที่สามจึงไม่ได้กันอะไรเพิ่ม
    /// แต่รับประกันว่าจะหลุด sync ตอนเพิ่มสถานะใหม่ แล้ว AI จะเจอ "ทำไม่ได้"
    /// จาก MCP ทั้งที่ API ยอมรับค่านั้นแล้ว
    /// </remarks>
    private static string? Norm(string? status) =>
        string.IsNullOrWhiteSpace(status) ? null : status.Trim().ToLowerInvariant();

    /// <summary>
    /// ห่อการทำงานของ tool ให้ error กลายเป็นข้อความที่ Claude อ่านแล้วแก้ตัวเองได้
    /// </summary>
    /// <remarks>
    /// ⚠️ ต้องมี — ถ้าปล่อย exception หลุดออกไป MCP SDK จะกลืนข้อความจริงทิ้ง
    ///    แล้วส่งกลับแค่ "An error occurred invoking 'update_page'." เท่านั้น
    ///    (ไม่มี option ระดับ SDK ให้เปิดรายละเอียด — ตรวจแล้วใน 2.0.0-rc.1)
    ///
    ///    ผลคือ Claude รู้แค่ว่า "พัง" แต่ไม่รู้ว่าพังเพราะอะไร จึงมักลองซ้ำ
    ///    แบบเดิมวนไปเรื่อย ๆ แทนที่จะแก้ค่าที่ส่งผิด ซึ่งเปลืองกว่าและจบไม่ลง
    ///
    /// คืนเป็นข้อความปกติไม่ใช่ isError เพราะเคสหลักคือ "ผู้เรียกส่งค่าผิด"
    /// ซึ่งเป็นผลลัพธ์ที่คาดไว้ ไม่ใช่ระบบพัง
    /// </remarks>
    private static async Task<string> Run(Func<Task<string>> work)
    {
        try
        {
            return await work();
        }
        catch (OperationCanceledException)
        {
            throw;   // ผู้เรียกยกเลิกเอง ไม่ใช่ความผิดพลาด
        }
        catch (InvalidOperationException ex)
        {
            // ทุก error ที่เราตั้งใจโยน (validation, API ตอบไม่สำเร็จ, ต่อ API ไม่ได้)
            return $"ทำไม่ได้: {ex.Message}";
        }
        catch (Exception ex)
        {
            return $"เกิดข้อผิดพลาดที่ไม่คาดคิด — {ex.GetType().Name}: {ex.Message}";
        }
    }

    // ─── อ่าน ────────────────────────────────────────────────────────────

    [McpServerTool(Name = "find_pages")]
    [Description("ค้นหาและแสดงรายการหน้า/งานใน workspace. " +
                 "ไม่ระบุอะไรเลย = แสดงโปรเจกต์ทั้งหมด (หน้าระดับบนสุด) พร้อมจำนวนงานค้าง. " +
                 "ระบุ query = ค้นหาข้อความในชื่อและเนื้อหา (ภาษาไทยได้). " +
                 "ระบุ parent_id = แสดงงานใต้หน้านั้น. " +
                 "ระบุ status = กรองเฉพาะสถานะนั้น (todo/doing/done). " +
                 "in_trash=true = ดูหน้าที่ถูกลบไว้ในถังขยะ")]
    public static Task<string> FindPages(
        PmClient client,
        [Description("คำค้นในชื่อและเนื้อหาหน้า — เว้นว่างเพื่อไม่ค้นหา")] string? query = null,
        [Description("id ของหน้าแม่ — แสดงเฉพาะงานที่อยู่ใต้หน้านี้")] Guid? parentId = null,
        [Description("กรองเฉพาะสถานะนี้: todo / doing / done")] string? status = null,
        [Description("รวมงานที่เสร็จแล้วด้วยไหม (ค่าเริ่มต้น false) — ไม่มีผลเมื่อระบุ status")] bool includeDone = false,
        [Description("ดูถังขยะแทนหน้าที่ใช้งานอยู่ (ค่าเริ่มต้น false)")] bool inTrash = false,
        CancellationToken ct = default) => Run(async () =>
    {
        var wantStatus = Norm(status);

        // ─── ถังขยะ ──────────────────────────────────────────────────────
        if (inTrash)
        {
            var trashed = await client.GetTrashAsync(ct);
            if (trashed.Count == 0) return "ถังขยะว่าง";

            var bin = new StringBuilder($"หน้าในถังขยะ ({trashed.Count}):\n");
            foreach (var t in trashed.OrderByDescending(t => t.DeletedAt))
                bin.AppendLine($"{Emoji(t.Status)} {Title(t.Title)}  ลบเมื่อ {t.DeletedAt:yyyy-MM-dd HH:mm}  id={t.Id}");
            bin.Append("กู้คืนด้วย restore_page");
            return bin.ToString();
        }

        // ─── ค้นหาข้อความ ────────────────────────────────────────────────
        if (!string.IsNullOrWhiteSpace(query))
        {
            var result = await client.SearchAsync(query, wantStatus, DefaultLimit, ct);

            if (result.Count == 0)
                return $"ไม่พบหน้าที่ตรงกับ \"{result.Query}\"";

            var found = new StringBuilder($"พบ {result.Count} หน้าที่ตรงกับ \"{result.Query}\"");
            if (result.Truncated) found.Append($" (แสดง {DefaultLimit} รายการแรก — มีมากกว่านี้)");
            found.AppendLine(":");

            foreach (var h in result.Hits)
            {
                found.AppendLine($"{Emoji(h.Status)} {Title(h.Title)}  [{h.Status ?? "ไม่ใช่งาน"}]  id={h.Id}");

                // snippet มาเป็น HTML จาก pgroonga_snippet_html — ถอด tag ออกก่อน
                // เพราะ AI อ่าน plain text แล้วเข้าใจง่ายกว่า และ tag กินโทเคนเปล่า ๆ
                var snippet = StripTags(h.Snippet);
                if (snippet.Length > 0) found.AppendLine($"     …{snippet}…");
            }
            return found.ToString().TrimEnd();
        }

        // ─── รายการจาก tree ─────────────────────────────────────────────
        var tree = await client.GetTreeAsync(ct);
        var live = tree.Where(n => n.DeletedAt is null).ToList();

        // ไม่ระบุอะไรเลย = ภาพรวมระดับโปรเจกต์ ซึ่งเป็นสิ่งที่ AI ต้องรู้ก่อนทำอะไร
        if (parentId is null && wantStatus is null)
        {
            var projects = live.Where(n => n.ParentId is null)
                               .OrderBy(n => n.Rank, StringComparer.Ordinal).ToList();

            if (projects.Count == 0)
                return $"[{client.WorkspaceName}] ยังไม่มีโปรเจกต์ — สร้างด้วย create_page";

            var sb = new StringBuilder($"โปรเจกต์ใน workspace \"{client.WorkspaceName}\":\n");
            foreach (var p in projects)
            {
                var children = live.Where(n => n.ParentId == p.Id).ToList();
                var open = children.Count(c => c.Status != "done");
                sb.AppendLine(
                    $"- {p.Icon ?? "📁"} {Title(p.Title)}  ·  งานค้าง {open}/{children.Count}  ·  id={p.Id}");
            }
            return sb.ToString().TrimEnd();
        }

        IEnumerable<PageNode> pages = live;

        pages = parentId is { } pid
            ? pages.Where(n => n.ParentId == pid)
            : pages.Where(n => n.Status is not null);

        if (wantStatus is not null) pages = pages.Where(n => n.Status == wantStatus);
        else if (!includeDone) pages = pages.Where(n => n.Status != "done");

        // ⚠️ rank เป็น fractional index ต้องเทียบแบบ byte order เท่านั้น
        //    คอลัมน์ฝั่งฐานตั้ง COLLATE "C" ไว้ด้วยเหตุผลเดียวกัน — ถ้าเรียงด้วย
        //    culture ของเครื่อง ลำดับที่ AI เห็นจะไม่ตรงกับที่ผู้ใช้เห็นบนเว็บ
        var list = pages.OrderBy(n => n.Rank, StringComparer.Ordinal).ToList();
        if (list.Count == 0) return "ไม่มีงานตรงเงื่อนไข";

        var out_ = new StringBuilder();
        foreach (var t in list)
            out_.AppendLine($"{Emoji(t.Status)} {Title(t.Title)}  [{t.Status ?? "ไม่ใช่งาน"}]  id={t.Id}");
        return out_.ToString().TrimEnd();
    });

    [McpServerTool(Name = "get_page")]
    [Description("ดูรายละเอียดหน้าหนึ่งจาก id — สถานะ, หน้าแม่, งานลูกที่อยู่ข้างใต้ " +
                 "และเนื้อหาของหน้า (include_content=true ซึ่งเป็นค่าเริ่มต้น)")]
    public static Task<string> GetPage(
        PmClient client,
        [Description("id ของหน้า/งาน")] Guid pageId,
        [Description("อ่านเนื้อหาของหน้าด้วยไหม (ค่าเริ่มต้น true)")] bool includeContent = true,
        CancellationToken ct = default) => Run(async () =>
    {
        var page = await client.GetPageAsync(pageId, ct);
        var tree = await client.GetTreeAsync(ct);
        var children = tree.Where(n => n.ParentId == pageId && n.DeletedAt is null)
                           .OrderBy(n => n.Rank, StringComparer.Ordinal).ToList();

        var sb = new StringBuilder();
        sb.AppendLine($"{Emoji(page.Status)} {Title(page.Title)}");
        sb.AppendLine($"  id      : {page.Id}");
        sb.AppendLine($"  สถานะ   : {page.Status ?? "(ไม่มี — ไม่ใช่งาน)"}");
        sb.AppendLine($"  parent  : {(page.ParentId?.ToString() ?? "(ระดับบนสุด = โปรเจกต์)")}");
        sb.AppendLine($"  อัปเดต  : {page.UpdatedAt:yyyy-MM-dd HH:mm}");

        if (children.Count > 0)
        {
            sb.AppendLine($"  งานลูก ({children.Count}):");
            foreach (var c in children)
                sb.AppendLine($"    {Emoji(c.Status)} {Title(c.Title)}  id={c.Id}");
        }

        if (includeContent)
        {
            var content = await client.GetContentAsync(pageId, ct);
            sb.AppendLine();

            // ─────────────────────────────────────────────────────────────
            //  ⚠️ ต้องแยก "หน้าว่าง" จาก "ยังไม่มีข้อมูล" ให้ชัด
            //
            //  เนื้อหาจริงเป็น Yjs CRDT ที่เซิร์ฟเวอร์อ่านไม่ออก ข้อความที่ได้มา
            //  คือ projection ที่เบราว์เซอร์แกะแล้วส่งกลับ หน้าที่ยังไม่มีใครเปิด
            //  จึงไม่มีข้อความ — ถ้ารายงานว่า "ว่าง" เฉย ๆ AI จะสรุปผิดว่าหน้านี้
            //  ไม่มีอะไรอยู่ แล้วอาจไปเขียนทับหรือรายงานให้เจ้าของผิด
            // ─────────────────────────────────────────────────────────────
            if (content.Freshness == "never")
            {
                sb.AppendLine("เนื้อหา: (ยังไม่มีข้อมูล — ยังไม่เคยมีใครเปิดหน้านี้ในเบราว์เซอร์");
                sb.AppendLine("         ไม่ได้แปลว่าหน้านี้ว่าง)");
            }
            else if (content.BodyText.Length == 0)
            {
                sb.AppendLine("เนื้อหา: (ว่างจริง — เปิดในเบราว์เซอร์แล้วแต่ยังไม่มีข้อความ)");
            }
            else
            {
                sb.AppendLine($"เนื้อหา (ณ {content.ProjectionUpdatedAt:yyyy-MM-dd HH:mm}):");
                sb.AppendLine(content.BodyText);

                // เตือนเมื่อ metadata ใหม่กว่าข้อความอย่างเห็นได้ชัด
                if (content.ProjectionUpdatedAt is { } projected
                    && content.PageUpdatedAt - projected > TimeSpan.FromMinutes(5))
                {
                    sb.AppendLine();
                    sb.AppendLine($"⚠️ หน้าถูกแก้ล่าสุด {content.PageUpdatedAt:yyyy-MM-dd HH:mm} " +
                                  "ซึ่งใหม่กว่าข้อความข้างบน — ข้อความอาจไม่ใช่ฉบับล่าสุด");
                }
            }
        }

        return sb.ToString().TrimEnd();
    });

    // ─── เขียน ───────────────────────────────────────────────────────────

    [McpServerTool(Name = "create_page")]
    [Description("สร้างหน้าใหม่. ไม่ระบุ parent_id = สร้างโปรเจกต์ (หน้าระดับบนสุด). " +
                 "ระบุ parent_id = สร้างงานใต้หน้านั้น. " +
                 "ระบุ status เพื่อให้เป็นงานทันที (todo/doing/done)")]
    public static Task<string> CreatePage(
        PmClient client,
        [Description("ชื่อหน้า/งาน")] string title,
        [Description("id ของหน้าแม่ — เว้นว่างเพื่อสร้างเป็นโปรเจกต์ระดับบนสุด")] Guid? parentId = null,
        [Description("สถานะเริ่มต้น: todo / doing / done — เว้นว่าง = เป็นหน้าปกติไม่ใช่งาน")] string? status = null,
        [Description("emoji ไอคอน (ไม่บังคับ)")] string? icon = null,
        CancellationToken ct = default) => Run(async () =>
    {
        // คำขอเดียว — เดิมเป็น POST แล้ว PATCH ตาม ซึ่งล้มกลางทางแล้วเหลือหน้าที่
        // ไม่มีสถานะค้างไว้ ตอนนี้ API รับ status ตอนสร้างแล้ว
        var page = await client.CreatePageAsync(parentId, title, icon, Norm(status), ct);

        var kind = parentId is null ? "โปรเจกต์" : "งาน";
        var suffix = page.Status is null ? "" : $"  [{page.Status}]";
        return $"สร้าง{kind}แล้ว: {Emoji(page.Status)} {Title(page.Title)}{suffix}  id={page.Id}";
    });

    [McpServerTool(Name = "update_page")]
    [Description("แก้หน้า: เปลี่ยนชื่อ (title), สถานะ (status: todo/doing/done, " +
                 "หรือ clear_status=true เพื่อทำให้ไม่ใช่งาน), ไอคอน (icon), " +
                 "หรือย้ายไปอยู่ใต้หน้าอื่น (new_parent_id). ส่งเฉพาะสิ่งที่ต้องการเปลี่ยน")]
    public static Task<string> UpdatePage(
        PmClient client,
        [Description("id ของหน้า/งาน")] Guid pageId,
        [Description("ชื่อใหม่ (ไม่บังคับ)")] string? title = null,
        [Description("สถานะใหม่: todo / doing / done (ไม่บังคับ)")] string? status = null,
        [Description("ล้างสถานะให้กลับเป็นหน้าปกติที่ไม่ใช่งาน")] bool clearStatus = false,
        [Description("emoji ไอคอนใหม่ (ไม่บังคับ)")] string? icon = null,
        [Description("id ของหน้าแม่ใหม่ — ย้ายหน้านี้พร้อมลูกหลานไปอยู่ใต้หน้านั้น")] Guid? newParentId = null,
        [Description("ย้ายขึ้นเป็นโปรเจกต์ระดับบนสุด (ใช้แทน new_parent_id)")] bool moveToTopLevel = false,
        CancellationToken ct = default) => Run(async () =>
    {
        var nothingToChange = title is null && status is null && !clearStatus
            && icon is null && newParentId is null && !moveToTopLevel;

        if (nothingToChange)
            return "ไม่มีอะไรให้เปลี่ยน — ระบุ title, status, clear_status, icon, " +
                   "new_parent_id หรือ move_to_top_level อย่างน้อยหนึ่งอย่าง";

        if (status is not null && clearStatus)
            return "เลือกอย่างเดียว: จะตั้ง status หรือจะ clear_status";

        if (newParentId is not null && moveToTopLevel)
            return "เลือกอย่างเดียว: จะย้ายไปใต้ new_parent_id หรือจะย้ายขึ้นระดับบนสุด";

        var messages = new List<string>();

        // ─── ย้าย ───────────────────────────────────────────────────────
        if (newParentId is not null || moveToTopLevel)
        {
            var moved = await client.MovePageAsync(pageId, newParentId, null, ct);
            messages.Add(moved.AffectedDescendants > 1
                ? $"ย้ายแล้วพร้อมลูกหลาน {moved.AffectedDescendants - 1} หน้า"
                : "ย้ายแล้ว");
        }

        // ─── ชื่อ / สถานะ / ไอคอน ────────────────────────────────────────
        if (title is not null || status is not null || clearStatus || icon is not null)
        {
            // "" (สตริงว่าง) คือค่าที่ API ใช้แทน "ล้างสถานะ" — ต่างจาก null ที่แปลว่า
            // "ไม่แตะ" (ดู UpdatePageRequest ฝั่ง API)
            var statusValue = clearStatus ? "" : Norm(status);

            var page = await client.UpdatePageAsync(pageId, title, icon, statusValue, ct);
            messages.Add(
                $"{Emoji(page.Status)} {Title(page.Title)}  [{page.Status ?? "ไม่ใช่งาน"}]");
        }

        return $"อัปเดตแล้ว: {string.Join("  ·  ", messages)}  id={pageId}";
    });

    [McpServerTool(Name = "delete_page")]
    [Description("ย้ายหน้าไปถังขยะพร้อมลูกหลานทั้งหมด — กู้คืนได้ด้วย restore_page. " +
                 "ไม่ใช่การลบถาวร")]
    public static Task<string> DeletePage(
        PmClient client,
        [Description("id ของหน้าที่จะย้ายไปถังขยะ")] Guid pageId,
        CancellationToken ct = default) => Run(async () =>
    {
        var affected = await client.DeletePageAsync(pageId, ct);
        return affected > 1
            ? $"ย้ายไปถังขยะแล้ว {affected} หน้า (รวมลูกหลาน) — กู้คืนได้ด้วย restore_page id={pageId}"
            : $"ย้ายไปถังขยะแล้ว — กู้คืนได้ด้วย restore_page id={pageId}";
    });

    [McpServerTool(Name = "restore_page")]
    [Description("กู้คืนหน้าจากถังขยะพร้อมลูกหลาน. " +
                 "ถ้าหน้าแม่ยังอยู่ในถังขยะจะกู้ไม่ได้ — ต้องกู้หน้าแม่ก่อน")]
    public static Task<string> RestorePage(
        PmClient client,
        [Description("id ของหน้าที่จะกู้คืน (ดูจาก find_pages in_trash=true)")] Guid pageId,
        CancellationToken ct = default) => Run(async () =>
    {
        var affected = await client.RestorePageAsync(pageId, ct);
        return affected > 1
            ? $"กู้คืนแล้ว {affected} หน้า (รวมลูกหลาน)  id={pageId}"
            : $"กู้คืนแล้ว  id={pageId}";
    });

    private static string Title(string title) =>
        string.IsNullOrWhiteSpace(title) ? "(ไม่มีชื่อ)" : title;

    /// <summary>
    /// ถอด HTML tag ออกจาก snippet ของ PGroonga
    /// </summary>
    /// <remarks>
    /// pgroonga_snippet_html ครอบคำที่ตรงด้วย &lt;span class="keyword"&gt; ซึ่งมีประโยชน์
    /// กับเบราว์เซอร์แต่กินโทเคนเปล่า ๆ เมื่อผู้อ่านเป็นโมเดล
    ///
    /// เขียนเป็น loop ไม่ใช่ regex เพราะ regex ที่ถอด tag แบบครอบจักรวาลเป็นบ่อเกิด
    /// ของบั๊ก และที่นี่รูปแบบ input แคบและรู้แน่อยู่แล้ว
    /// </remarks>
    private static string StripTags(string html)
    {
        if (html.Length == 0) return string.Empty;

        var sb = new StringBuilder(html.Length);
        var inTag = false;

        foreach (var c in html)
        {
            if (c == '<') inTag = true;
            else if (c == '>') inTag = false;
            else if (!inTag) sb.Append(c);
        }

        return sb.ToString().Replace("&lt;", "<").Replace("&gt;", ">").Replace("&amp;", "&").Trim();
    }
}
