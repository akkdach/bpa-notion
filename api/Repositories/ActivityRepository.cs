using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Repositories;

// ═══════════════════════════════════════════════════════════════════════════
//  ActivityRepository
//
//  ⚠️ การ "เขียน" activity ส่วนใหญ่ไม่ได้เกิดที่นี่ แต่เกิดใน PageRepository
//     ซึ่งเป็นที่ที่ธุรกรรมของการเปลี่ยนแปลงถูกเปิดอยู่แล้ว
//
//     ถ้าเขียน log จาก service หลังจาก mutation สำเร็จ log จะโกหกได้สองทาง:
//     mutation สำเร็จแต่ log ล้ม (ประวัติหาย) หรือ log สำเร็จแต่ mutation rollback
//     (ประวัติบอกถึงสิ่งที่ไม่เคยเกิด) — ทั้งคู่แย่กว่าไม่มีประวัติ
// ═══════════════════════════════════════════════════════════════════════════
public class ActivityRepository(AppDbContext db) : IActivityRepository
{
    public async Task AddAsync(ActivityLog entry, CancellationToken ct = default)
    {
        db.ActivityLogs.Add(entry);
        await db.SaveChangesAsync(ct);
    }

    public Task<List<ActivityRow>> ListAsync(
        IReadOnlyList<Guid>? pageIds,
        Guid? pageId,
        DateTimeOffset? since,
        int limit,
        CancellationToken ct = default)
    {
        // tenant filter ของ ActivityLog ทำงานอยู่ — ไม่ต้องกรอง workspace เอง
        var query = db.ActivityLogs.AsNoTracking();

        if (pageId is { } single)
        {
            query = query.Where(a => a.PageId == single);
        }
        else if (pageIds is not null)
        {
            // แถวที่หน้าถูกลบถาวรไปแล้ว (page_id = null) ต้องติดมาด้วย — ดูคอมเมนต์
            // ที่ IActivityRepository.ListAsync
            query = query.Where(a => a.PageId == null || pageIds.Contains(a.PageId.Value));
        }

        if (since is { } from) query = query.Where(a => a.CreatedAt > from);

        // ⚠️ OrderBy ต้องอยู่ก่อน projection ไม่งั้น EF แปลเป็น SQL ไม่ได้
        //    (เจอมาแล้วตอน Stage B — ดู IdentityQueries)
        //
        // เรียงด้วย id ปิดท้ายเพราะหลายเหตุการณ์เกิดใน now() เดียวกันได้ (เขียนใน
        // ธุรกรรมเดียว) ถ้าไม่มีตัวตัดสิน ลำดับจะไม่คงที่ระหว่างการเรียกซ้ำ
        return query
            .OrderByDescending(a => a.CreatedAt)
            .ThenByDescending(a => a.Id)
            .Take(limit)
            .Select(a => new ActivityRow(
                a.Id,
                a.PageId,
                a.PageTitle,
                a.ActorUserId,
                // left join ด้วยมือ — ผู้ทำอาจถูกลบบัญชีไปแล้ว แต่ประวัติต้องยังอ่านได้
                // (users ไม่มี tenant filter จึงเข้าถึงได้ตรง ๆ — ดู AppDbContext)
                db.Users.Where(u => u.Id == a.ActorUserId).Select(u => u.Name).FirstOrDefault(),
                db.Users.Where(u => u.Id == a.ActorUserId)
                        .Select(u => (UserKind?)u.Kind).FirstOrDefault(),
                a.Action,
                a.Detail,
                a.CreatedAt))
            .ToListAsync(ct);
    }
}
