using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Repositories;

public class NoteRepository(AppDbContext db) : INoteRepository
{
    public Task<PageNote> AddAsync(
        PageNote note, ActivityLog activity, CancellationToken ct = default)
        => db.InTransactionAsync(async token =>
        {
            db.PageNotes.Add(note);
            db.ActivityLogs.Add(activity);
            await db.SaveChangesAsync(token);
            return note;
        }, ct);

    public Task<List<NoteRow>> ListAsync(
        Guid pageId, int limit, CancellationToken ct = default)
        // ⚠️ OrderBy ต้องอยู่ก่อน projection ไม่งั้น EF แปลเป็น SQL ไม่ได้
        //
        // เรียง "เก่าไปใหม่" ต่างจาก activity feed เพราะบันทึกอ่านเป็นลำดับเวลา
        // เหมือนบทสนทนา ส่วนฟีดกิจกรรมอ่าน "อะไรเพิ่งเกิด" จึงเรียงกลับกัน
        //
        // Take(limit) หลัง OrderBy ascending = ได้บันทึกเก่าที่สุด ซึ่งถูกสำหรับ
        // หน้าที่มีบันทึกไม่มาก และเป็นพฤติกรรมที่อธิบายได้ (อ่านตั้งแต่ต้น)
        => db.PageNotes.AsNoTracking()
             .Where(n => n.PageId == pageId)
             .OrderBy(n => n.CreatedAt).ThenBy(n => n.Id)
             .Take(limit)
             .Select(n => new NoteRow(
                 n.Id,
                 n.PageId,
                 n.AuthorUserId,
                 // users ไม่มี tenant filter — ดู AppDbContext
                 db.Users.Where(u => u.Id == n.AuthorUserId).Select(u => u.Name).FirstOrDefault(),
                 db.Users.Where(u => u.Id == n.AuthorUserId)
                         .Select(u => (UserKind?)u.Kind).FirstOrDefault(),
                 n.Body,
                 n.CreatedAt))
             .ToListAsync(ct);
}
