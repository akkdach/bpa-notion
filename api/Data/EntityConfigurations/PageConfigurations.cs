using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Data.EntityConfigurations;

public class PageConfiguration : IEntityTypeConfiguration<Page>
{
    public void Configure(EntityTypeBuilder<Page> builder)
    {
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).HasDefaultValueSql("gen_random_uuid()");

        // ─────────────────────────────────────────────────────────────────
        //  ⚠️ unique (workspace_id, id) มีไว้เพื่อให้ตารางลูกอ้าง composite FK ได้
        //
        //  นี่คือ defense in depth ที่ช่วยจริงตอน C# มีบั๊ก: เมื่อ
        //  page_doc_updates (workspace_id, page_id) → pages (workspace_id, id)
        //  การอ้างข้าม workspace จะ "เป็นไปไม่ได้" ไม่ใช่แค่ "ไม่น่าเกิด"
        //  เพิ่มตอนนี้ราคาถูก ย้อนกลับมาเพิ่มทีหลังแทบไม่ได้
        // ─────────────────────────────────────────────────────────────────
        builder.HasAlternateKey(p => new { p.WorkspaceId, p.Id });

        builder.Property(p => p.AncestorIds)
               .HasColumnType("uuid[]")
               .IsRequired()
               .HasDefaultValueSql("'{}'::uuid[]");

        builder.Property(p => p.Depth).IsRequired().HasDefaultValue(0);

        // ─────────────────────────────────────────────────────────────────
        //  ⚠️ rank ต้องเป็น COLLATE "C" — byte order ล้วน ๆ
        //
        //  fractional index ใช้ base62 (0-9 A-Z a-z) และอัลกอริทึมทั้งหมด
        //  ตั้งอยู่บนสมมติฐานว่าการเทียบสตริงเป็น "ordinal"
        //
        //  แต่ฐานนี้ตั้ง ICU th-TH เป็น collation หลัก ซึ่งเรียงแบบ
        //      a0  A0  b0  B0  z0  Z0
        //  ขณะที่ byte order เรียงแบบ
        //      A0  B0  Z0  a0  b0  z0
        //
        //  ถ้าไม่บังคับ collation ตรงนี้ ORDER BY rank จะให้ลำดับที่ไม่ตรงกับ
        //  ที่ generateKeyBetween คำนวณไว้ → หน้าเรียงสลับกันเอง และการแทรก
        //  ครั้งถัดไปจะคำนวณจากคู่ที่ผิด อาการจะโผล่ก็ต่อเมื่อมี rank ที่ปนตัว
        //  พิมพ์ใหญ่พิมพ์เล็ก ซึ่งเกิดหลังแทรก/ลบไปสักพัก — คือหลัง deploy
        // ─────────────────────────────────────────────────────────────────
        builder.Property(p => p.Rank)
               .IsRequired()
               .HasMaxLength(200)
               .UseCollation("C");

        builder.Property(p => p.Kind)
               .HasConversion(RoleConverters.PageKind)
               .HasMaxLength(20)
               .IsRequired();

        builder.Property(p => p.Title).IsRequired().HasDefaultValue(string.Empty);
        builder.Property(p => p.Icon).HasMaxLength(200);
        builder.Property(p => p.CoverUrl).HasMaxLength(1000);

        // JsonDocument (ไม่ใช่ POCO) แปลว่าไม่ต้องเปิด Npgsql EnableDynamicJson()
        builder.Property(p => p.Properties).HasColumnType("jsonb");
        builder.Property(p => p.Computed).HasColumnType("jsonb");

        builder.Property(p => p.CreatedAt).HasDefaultValueSql("now()");
        builder.Property(p => p.UpdatedAt).HasDefaultValueSql("now()");

        builder.HasOne<Workspace>()
               .WithMany()
               .HasForeignKey(p => p.WorkspaceId)
               .OnDelete(DeleteBehavior.Cascade);

        // ─────────────────────────────────────────────────────────────────
        //  self-FK แบบ composite — ลูกต้องอยู่ workspace เดียวกับพ่อเสมอ
        //
        //  ⚠️ IsRequired(false) สำคัญ: navigation ที่ required + global query
        //     filter จะกลายเป็น INNER JOIN แล้ว "ตัดแถวแม่ที่ filter ไม่ผ่าน
        //     ออกไปเงียบ ๆ" ทำให้ผลลัพธ์สั้นกว่าที่ควร ซึ่งเป็น footgun ที่
        //     EF documented ไว้เอง
        // ─────────────────────────────────────────────────────────────────
        builder.HasOne(p => p.Parent)
               .WithMany(p => p.Children)
               .HasForeignKey(p => new { p.WorkspaceId, p.ParentId })
               .HasPrincipalKey(p => new { p.WorkspaceId, p.Id })
               .IsRequired(false)
               .OnDelete(DeleteBehavior.Restrict);   // ลบผ่าน soft-delete เท่านั้น

        // sidebar tree — partial index (WHERE …) เติมด้วย raw SQL ใน migration
        builder.HasIndex(p => new { p.WorkspaceId, p.ParentId, p.Rank });
        builder.HasIndex(p => new { p.WorkspaceId, p.AccessRootId });
        builder.HasIndex(p => new { p.DatabaseId, p.Rank });
    }
}

public class PageAclConfiguration : IEntityTypeConfiguration<PageAcl>
{
    public void Configure(EntityTypeBuilder<PageAcl> builder)
    {
        // SubjectId เป็น Guid.Empty (ไม่ใช่ null) เมื่อ subject_type = workspace
        // เพราะคอลัมน์ใน PK เป็น NULL ไม่ได้ — ดู PageAcl.SubjectId
        builder.HasKey(a => new { a.PageId, a.SubjectType, a.SubjectId });

        builder.Property(a => a.SubjectType)
               .HasConversion(RoleConverters.AclSubjectType)
               .HasMaxLength(20)
               .IsRequired();

        builder.Property(a => a.Role)
               .HasConversion(RoleConverters.PageRole)
               .HasMaxLength(20)
               .IsRequired();

        builder.Property(a => a.GrantedAt).HasDefaultValueSql("now()");

        builder.HasOne(a => a.Page)
               .WithMany()
               .HasForeignKey(a => new { a.WorkspaceId, a.PageId })
               .HasPrincipalKey(p => new { p.WorkspaceId, p.Id })
               .OnDelete(DeleteBehavior.Cascade);

        // resolve สิทธิ์: JOIN page_acl ON page_acl.page_id = pages.access_root_id
        builder.HasIndex(a => new { a.PageId, a.SubjectType, a.SubjectId });
    }
}
