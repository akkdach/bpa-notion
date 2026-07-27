using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Data.EntityConfigurations;

// ═══════════════════════════════════════════════════════════════════════════
//  ตารางที่รองรับ "การทำงานร่วมกันระหว่างคนกับ AI"
//    · page_notes    — ช่องเขียนข้อความที่ไม่ต้องแตะ CRDT
//    · activity_log  — ใครทำอะไรเมื่อไหร่ เพื่อให้เจ้าของตรวจงานได้
// ═══════════════════════════════════════════════════════════════════════════

public class PageNoteConfiguration : IEntityTypeConfiguration<PageNote>
{
    public void Configure(EntityTypeBuilder<PageNote> builder)
    {
        builder.HasKey(n => n.Id);
        builder.Property(n => n.Id).HasDefaultValueSql("gen_random_uuid()");

        // ยาวพอสำหรับบันทึกความคืบหน้าหรือสรุปย่อ แต่ไม่ใช่ที่เก็บเอกสาร
        // — ถ้า AI อยากเขียนยาวกว่านี้ มันควรเขียนลงหน้าจริง ไม่ใช่ลงบันทึก
        builder.Property(n => n.Body).IsRequired().HasMaxLength(4000);

        builder.Property(n => n.CreatedAt).HasDefaultValueSql("now()");

        // ─────────────────────────────────────────────────────────────────
        //  ⚠️ composite FK — ชั้นที่สามของ tenant isolation
        //
        //  ชั้นที่หนึ่งคือคอลัมน์ workspace_id ชั้นที่สองคือ named query filter
        //  ใน AppDbContext ชั้นที่สามคือ FK นี้ ซึ่งทำให้การอ้างข้ามworkspace
        //  "เป็นไปไม่ได้" ที่ระดับฐานข้อมูล ไม่ใช่แค่ "ไม่น่าเกิด" ตอน C# ถูก
        //
        //  CASCADE ถูกต้องที่นี่: บันทึกของหน้าที่ถูกลบถาวรไม่มีความหมายอีก
        //  (ต่างจาก activity_log ที่ต้องเก็บไว้เป็นหลักฐาน — ดูข้างล่าง)
        // ─────────────────────────────────────────────────────────────────
        builder.HasOne(n => n.Page)
               .WithMany()
               .HasForeignKey(n => new { n.WorkspaceId, n.PageId })
               .HasPrincipalKey(p => new { p.WorkspaceId, p.Id })
               .OnDelete(DeleteBehavior.Cascade);

        // อ่านบันทึกของหน้าหนึ่งเรียงตามเวลา — เป็น query เดียวที่ใช้จริง
        builder.HasIndex(n => new { n.WorkspaceId, n.PageId, n.CreatedAt });
    }
}

public class ActivityLogConfiguration : IEntityTypeConfiguration<ActivityLog>
{
    public void Configure(EntityTypeBuilder<ActivityLog> builder)
    {
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).UseIdentityAlwaysColumn();

        builder.Property(a => a.Action).IsRequired().HasMaxLength(40);
        builder.Property(a => a.PageTitle).IsRequired().HasMaxLength(400);
        builder.Property(a => a.Detail).HasColumnType("jsonb");
        builder.Property(a => a.CreatedAt).HasDefaultValueSql("now()");

        // ─────────────────────────────────────────────────────────────────
        //  ⚠️ SET NULL ไม่ใช่ CASCADE — ต่างจากทุกตารางลูกอื่นในระบบ
        //
        //  ถ้า CASCADE การ purge หน้าจะลบประวัติของหน้านั้นทิ้งไปด้วย ซึ่งลบ
        //  หลักฐานพอดีตอนที่คำถาม "ใครลบหน้านี้ และมันเคยชื่ออะไร" มีค่าที่สุด
        //
        //  แถวที่ page_id เป็น null จึงอ่านได้ต่อไปจาก page_title ที่เก็บสำเนาไว้
        // ─────────────────────────────────────────────────────────────────
        builder.HasOne<Page>()
               .WithMany()
               .HasForeignKey(a => new { a.WorkspaceId, a.PageId })
               .HasPrincipalKey(p => new { p.WorkspaceId, p.Id })
               .OnDelete(DeleteBehavior.SetNull);

        // ฟีดกิจกรรมอ่านย้อนเวลาเสมอ — index ตรงกับ ORDER BY created_at DESC, id DESC
        builder.HasIndex(a => new { a.WorkspaceId, a.CreatedAt });

        // "ประวัติของหน้านี้" ในแผงข้างหน้า
        builder.HasIndex(a => new { a.WorkspaceId, a.PageId, a.CreatedAt });
    }
}
