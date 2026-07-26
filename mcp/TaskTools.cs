using System.ComponentModel;
using System.Text;
using ModelContextProtocol.Server;

namespace ProjectManagementMcp;

// ═══════════════════════════════════════════════════════════════════════════
//  Tools ที่ Claude Code เรียกได้
//
//  โมเดล: โปรเจกต์ = หน้าระดับบนสุด, งาน = หน้าลูกใต้โปรเจกต์
//  สถานะงานเก็บในคอลัมน์ Status ของ Page (todo / doing / done)
// ═══════════════════════════════════════════════════════════════════════════
[McpServerToolType]
public static class TaskTools
{
    private static readonly string[] Allowed = ["todo", "doing", "done"];

    private static string Emoji(string? status) => status switch
    {
        "todo" => "⬜",
        "doing" => "🔄",
        "done" => "✅",
        _ => "▫️"
    };

    private static string Norm(string status)
    {
        var s = status.Trim().ToLowerInvariant();
        if (!Allowed.Contains(s))
            throw new InvalidOperationException(
                $"สถานะต้องเป็น: {string.Join(" / ", Allowed)} (ได้รับ '{status}')");
        return s;
    }

    /// <summary>
    /// ห่อการทำงานของ tool ให้ error กลายเป็นข้อความที่ Claude อ่านแล้วแก้ตัวเองได้
    /// </summary>
    /// <remarks>
    /// ⚠️ ต้องมี — ถ้าปล่อย exception หลุดออกไป MCP SDK จะกลืนข้อความจริงทิ้ง
    ///    แล้วส่งกลับแค่ "An error occurred invoking 'update_task'." เท่านั้น
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

    [McpServerTool(Name = "list_projects")]
    [Description("แสดงโปรเจกต์ทั้งหมด (หน้าระดับบนสุด) ใน workspace พร้อมจำนวนงานในแต่ละโปรเจกต์และ id ที่ต้องใช้เรียก tool อื่น")]
    public static Task<string> ListProjects(PmClient client, CancellationToken ct = default) => Run(async () =>
    {
        var tree = await client.GetTreeAsync(ct);
        var projects = tree.Where(n => n.ParentId is null && n.DeletedAt is null)
                           .OrderBy(n => n.Rank, StringComparer.Ordinal).ToList();

        if (projects.Count == 0)
            return $"[{client.WorkspaceName}] ยังไม่มีโปรเจกต์ — สร้างด้วย create_project";

        var sb = new StringBuilder($"โปรเจกต์ใน workspace \"{client.WorkspaceName}\":\n");
        foreach (var p in projects)
        {
            var tasks = tree.Where(n => n.ParentId == p.Id && n.DeletedAt is null).ToList();
            var open = tasks.Count(t => t.Status != "done");
            sb.AppendLine($"- {p.Icon ?? "📁"} {Title(p.Title)}  ·  งานค้าง {open}/{tasks.Count}  ·  id={p.Id}");
        }
        return sb.ToString().TrimEnd();
    });

    [McpServerTool(Name = "list_tasks")]
    [Description("แสดงงานใต้โปรเจกต์ที่ระบุ (project_id) หรือถ้าไม่ระบุ = งานทุกหน้าที่มีสถานะทั้ง workspace. " +
                 "กรองด้วย status (todo/doing/done) ได้. โดยปกติซ่อนงานที่เสร็จแล้ว เว้นแต่ include_done=true")]
    public static Task<string> ListTasks(
        PmClient client,
        [Description("id ของโปรเจกต์ (จาก list_projects) — เว้นว่างเพื่อดูงานทั้ง workspace")] Guid? projectId = null,
        [Description("กรองเฉพาะสถานะนี้: todo / doing / done")] string? status = null,
        [Description("รวมงานที่เสร็จแล้วด้วยไหม (ค่าเริ่มต้น false)")] bool includeDone = false,
        CancellationToken ct = default) => Run(async () =>
    {
        var tree = await client.GetTreeAsync(ct);

        IEnumerable<PageNode> tasks = tree.Where(n => n.DeletedAt is null);

        tasks = projectId is { } pid
            ? tasks.Where(n => n.ParentId == pid)
            : tasks.Where(n => n.Status is not null);

        if (!string.IsNullOrWhiteSpace(status))
        {
            var want = Norm(status);
            tasks = tasks.Where(n => n.Status == want);
        }
        else if (!includeDone)
        {
            tasks = tasks.Where(n => n.Status != "done");
        }

        // ⚠️ rank เป็น fractional index ต้องเทียบแบบ byte order เท่านั้น
        //    คอลัมน์ฝั่งฐานตั้ง COLLATE "C" ไว้ด้วยเหตุผลเดียวกัน — ถ้าเรียงด้วย
        //    culture ของเครื่อง ลำดับที่ AI เห็นจะไม่ตรงกับที่ผู้ใช้เห็นบนเว็บ
        var list = tasks.OrderBy(n => n.Rank, StringComparer.Ordinal).ToList();
        if (list.Count == 0)
            return "ไม่มีงานตรงเงื่อนไข";

        var sb = new StringBuilder();
        foreach (var t in list)
            sb.AppendLine($"{Emoji(t.Status)} {Title(t.Title)}  [{t.Status ?? "no-status"}]  id={t.Id}");
        return sb.ToString().TrimEnd();
    });

    [McpServerTool(Name = "get_task")]
    [Description("ดูรายละเอียดงานหรือโปรเจกต์หนึ่งหน้าจาก id พร้อมงานลูกที่อยู่ข้างใต้")]
    public static Task<string> GetTask(
        PmClient client,
        [Description("id ของงาน/หน้า")] Guid taskId,
        CancellationToken ct = default) => Run(async () =>
    {
        var page = await client.GetPageAsync(taskId, ct);
        var tree = await client.GetTreeAsync(ct);
        var children = tree.Where(n => n.ParentId == taskId && n.DeletedAt is null)
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
        return sb.ToString().TrimEnd();
    });

    // ─── เขียน ───────────────────────────────────────────────────────────

    [McpServerTool(Name = "create_project")]
    [Description("สร้างโปรเจกต์ใหม่ (หน้าระดับบนสุด) คืน id ไว้ใช้สร้างงานข้างใต้")]
    public static Task<string> CreateProject(
        PmClient client,
        [Description("ชื่อโปรเจกต์")] string title,
        [Description("emoji ไอคอน (ไม่บังคับ)")] string? icon = null,
        CancellationToken ct = default) => Run(async () =>
    {
        var page = await client.CreatePageAsync(null, title, icon, ct);
        return $"สร้างโปรเจกต์แล้ว: {icon ?? "📁"} {Title(page.Title)}  id={page.Id}";
    });

    [McpServerTool(Name = "create_task")]
    [Description("สร้างงานใหม่ใต้โปรเจกต์ (project_id) ตั้งสถานะเริ่มต้นเป็น todo (หรือกำหนดเองได้)")]
    public static Task<string> CreateTask(
        PmClient client,
        [Description("id ของโปรเจกต์ที่จะสร้างงานข้างใต้ (จาก list_projects)")] Guid projectId,
        [Description("ชื่องาน")] string title,
        [Description("สถานะเริ่มต้น: todo / doing / done (ค่าเริ่มต้น todo)")] string status = "todo",
        [Description("emoji ไอคอน (ไม่บังคับ)")] string? icon = null,
        CancellationToken ct = default) => Run(async () =>
    {
        // ตรวจสถานะก่อนสร้าง — ไม่งั้นสถานะผิดจะทิ้งหน้าเปล่าไว้ในระบบ
        var s = Norm(status);

        var page = await client.CreatePageAsync(projectId, title, icon, ct);
        // create ไม่รับ status ตรง ๆ — เซ็ตด้วย PATCH ตามหลัง
        var withStatus = await client.UpdatePageAsync(page.Id, null, null, s, ct);
        return $"สร้างงานแล้ว: {Emoji(withStatus.Status)} {Title(page.Title)}  [{s}]  id={page.Id}";
    });

    [McpServerTool(Name = "update_task")]
    [Description("อัปเดตงาน: เปลี่ยนชื่อ (title), สถานะ (status: todo/doing/done), หรือไอคอน (icon). ส่งเฉพาะสิ่งที่ต้องการเปลี่ยน")]
    public static Task<string> UpdateTask(
        PmClient client,
        [Description("id ของงาน")] Guid taskId,
        [Description("ชื่อใหม่ (ไม่บังคับ)")] string? title = null,
        [Description("สถานะใหม่: todo / doing / done (ไม่บังคับ)")] string? status = null,
        [Description("emoji ไอคอนใหม่ (ไม่บังคับ)")] string? icon = null,
        CancellationToken ct = default) => Run(async () =>
    {
        if (title is null && status is null && icon is null)
            return "ไม่มีอะไรให้เปลี่ยน — ระบุ title, status หรือ icon อย่างน้อยหนึ่งอย่าง";

        var s = status is null ? null : Norm(status);
        var page = await client.UpdatePageAsync(taskId, title, icon, s, ct);
        return $"อัปเดตแล้ว: {Emoji(page.Status)} {Title(page.Title)}  [{page.Status ?? "no-status"}]  id={page.Id}";
    });

    [McpServerTool(Name = "complete_task")]
    [Description("ทำเครื่องหมายงานว่าเสร็จแล้ว (ตั้งสถานะ = done)")]
    public static Task<string> CompleteTask(
        PmClient client,
        [Description("id ของงานที่ทำเสร็จ")] Guid taskId,
        CancellationToken ct = default) => Run(async () =>
    {
        var page = await client.UpdatePageAsync(taskId, null, null, "done", ct);
        return $"✅ เสร็จแล้ว: {Title(page.Title)}  id={page.Id}";
    });

    private static string Title(string title) =>
        string.IsNullOrWhiteSpace(title) ? "(ไม่มีชื่อ)" : title;
}
