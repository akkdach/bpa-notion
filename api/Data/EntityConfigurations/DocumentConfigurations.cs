using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Data.EntityConfigurations;

// ═══════════════════════════════════════════════════════════════════════════
//  Yjs storage + search projection
//
//  ทั้งสามตารางอ้าง pages ด้วย composite FK (workspace_id, page_id) เพื่อให้
//  การอ้างข้าม workspace เป็นไปไม่ได้ที่ระดับฐานข้อมูล
// ═══════════════════════════════════════════════════════════════════════════

public class PageDocUpdateConfiguration : IEntityTypeConfiguration<PageDocUpdate>
{
    public void Configure(EntityTypeBuilder<PageDocUpdate> builder)
    {
        builder.HasKey(u => u.Seq);
        builder.Property(u => u.Seq).UseIdentityAlwaysColumn();

        // ชื่อคอลัมน์เป็น update_data ไม่ใช่ update เพราะ UPDATE เป็น reserved
        // keyword ของ Postgres — raw SQL จะต้อง quote ทุกครั้งที่อ้างถึง และการ
        // ลืม quote ให้ syntax error ที่อ่านไม่รู้เรื่อง ตารางนี้มี raw SQL
        // แน่ ๆ (bootstrap read, COPY insert ใน Phase 2) จึงไม่คุ้มที่จะเสี่ยง
        builder.Property(u => u.Update)
               .HasColumnName("update_data")
               .HasColumnType("bytea")
               .IsRequired();

        builder.Property(u => u.CreatedAt).HasDefaultValueSql("now()");

        builder.HasOne<Page>()
               .WithMany()
               .HasForeignKey(u => new { u.WorkspaceId, u.PageId })
               .HasPrincipalKey(p => new { p.WorkspaceId, p.Id })
               .OnDelete(DeleteBehavior.Cascade);

        // access path เดียวของตารางนี้: อ่าน update ของหน้าหนึ่งเรียงตาม seq
        builder.HasIndex(u => new { u.PageId, u.Seq });
    }
}

public class PageDocSnapshotConfiguration : IEntityTypeConfiguration<PageDocSnapshot>
{
    public void Configure(EntityTypeBuilder<PageDocSnapshot> builder)
    {
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).UseIdentityAlwaysColumn();

        builder.Property(s => s.Snapshot).HasColumnType("bytea").IsRequired();
        builder.Property(s => s.CreatedAt).HasDefaultValueSql("now()");

        builder.HasOne<Page>()
               .WithMany()
               .HasForeignKey(s => new { s.WorkspaceId, s.PageId })
               .HasPrincipalKey(p => new { p.WorkspaceId, p.Id })
               .OnDelete(DeleteBehavior.Cascade);

        // กัน snapshot ซ้ำที่จุดเดียวกัน (สอง client ได้รับคำสั่ง compact พร้อมกัน)
        builder.HasIndex(s => new { s.PageId, s.UpToSeq }).IsUnique();
    }
}

public class PageSearchConfiguration : IEntityTypeConfiguration<PageSearch>
{
    public void Configure(EntityTypeBuilder<PageSearch> builder)
    {
        builder.HasKey(s => s.PageId);

        builder.Property(s => s.Title).IsRequired().HasDefaultValue(string.Empty);
        builder.Property(s => s.BodyText).IsRequired().HasDefaultValue(string.Empty);
        builder.Property(s => s.UpdatedAt).HasDefaultValueSql("now()");

        // generated column — Postgres คำนวณให้ EF อ่านได้แต่เขียนไม่ได้
        builder.Property(s => s.SearchText)
               .HasComputedColumnSql("title || ' ' || body_text", stored: true);

        builder.HasOne<Page>()
               .WithMany()
               .HasForeignKey(s => new { s.WorkspaceId, s.PageId })
               .HasPrincipalKey(p => new { p.WorkspaceId, p.Id })
               .OnDelete(DeleteBehavior.Cascade);

        // กรองสิทธิ์ตอนค้นหาด้วย query เดียว: access_root_id = ANY($visibleRoots)
        builder.HasIndex(s => new { s.WorkspaceId, s.AccessRootId });

        // ⚠️ PGroonga index สร้างด้วย raw SQL ใน migration เพราะ EF เขียน
        //    WITH (tokenizer = …) ไม่ได้ และ tokenizer เป็นสิ่งที่ขาดไม่ได้
        //    (ค่า default ทำให้ค้นภาษาไทยพัง — ดู db/probe/thai-search-probe.sql)
    }
}

public class PageLinkConfiguration : IEntityTypeConfiguration<PageLink>
{
    public void Configure(EntityTypeBuilder<PageLink> builder)
    {
        builder.HasKey(l => new { l.SourcePageId, l.TargetPageId });

        builder.Property(l => l.UpdatedAt).HasDefaultValueSql("now()");

        // ─────────────────────────────────────────────────────────────────
        //  composite FK ทั้งสองฝั่ง
        //
        //  ลิงก์ข้าม workspace จึงเป็นสิ่งที่ "เขียนลงฐานไม่ได้" ไม่ใช่แค่ไม่ควรเกิด
        //  — ถ้ามีแต่ FK ธรรมดาไป pages(id) การเผลอเขียน workspace_id ผิดจะผ่าน
        //  ฉลุยแล้วกลายเป็นช่องอ่านข้าม tenant ผ่านแผง backlinks
        //
        //  Cascade ทั้งสองฝั่ง: ลบหน้าไหนก็ต้องไม่เหลือ edge ห้อยไว้ ทั้งขาออก
        //  และขาเข้า
        //
        //  ⚠️ ข้อห้าม "multiple cascade path มาที่ตารางเดียวกัน" เป็นข้อจำกัดของ
        //     SQL Server ไม่ใช่ PostgreSQL — Postgres ยอมทั้งสองทาง ถ้าเผลอตั้ง
        //     ฝั่ง target เป็น NoAction เพราะกลัวข้อจำกัดนั้น ผลคือ "ลบหน้าที่มี
        //     คนลิงก์มาไม่ได้เลย" ซึ่งพังในการใช้งานปกติ
        // ─────────────────────────────────────────────────────────────────
        builder.HasOne<Page>()
               .WithMany()
               .HasForeignKey(l => new { l.WorkspaceId, l.SourcePageId })
               .HasPrincipalKey(p => new { p.WorkspaceId, p.Id })
               .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<Page>()
               .WithMany()
               .HasForeignKey(l => new { l.WorkspaceId, l.TargetPageId })
               .HasPrincipalKey(p => new { p.WorkspaceId, p.Id })
               .OnDelete(DeleteBehavior.Cascade);

        // ทางอ่านหลักคือย้อนกลับ: "หน้านี้ถูกอ้างถึงจากที่ไหน"
        builder.HasIndex(l => new { l.WorkspaceId, l.TargetPageId });
    }
}
