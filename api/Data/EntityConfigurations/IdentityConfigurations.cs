using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Data.EntityConfigurations;

// ═══════════════════════════════════════════════════════════════════════════
//  identity + tenancy
//
//  ชื่อตาราง/คอลัมน์เป็น snake_case อัตโนมัติจาก UseSnakeCaseNamingConvention()
//  ไม่ต้องใส่ .ToTable() / .HasColumnName() เอง
// ═══════════════════════════════════════════════════════════════════════════

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.HasKey(u => u.Id);
        builder.Property(u => u.Id).HasDefaultValueSql("gen_random_uuid()");

        // citext = unique แบบไม่สนตัวพิมพ์ โดยไม่ต้องมี lower() index กระจายทุก query
        builder.Property(u => u.Email).HasColumnType("citext").IsRequired();
        builder.HasIndex(u => u.Email).IsUnique();

        builder.Property(u => u.PasswordHash).IsRequired().HasMaxLength(120);
        builder.Property(u => u.Name).IsRequired().HasMaxLength(200);
        builder.Property(u => u.AvatarUrl).HasMaxLength(1000);
        builder.Property(u => u.Locale).IsRequired().HasMaxLength(10).HasDefaultValue("th");

        // default ที่ระดับฐานด้วย ไม่ใช่แค่ใน C# — บัญชีที่ถูก INSERT จาก raw SQL
        // หรือ psql มือเปล่าต้องได้ 'human' ไม่ใช่ NULL
        builder.Property(u => u.Kind)
               .HasConversion(RoleConverters.UserKind)
               .IsRequired()
               .HasMaxLength(20)
               .HasDefaultValue(Domain.UserKind.Human);

        builder.Property(u => u.CreatedAt).HasDefaultValueSql("now()");
    }
}

public class ApiTokenConfiguration : IEntityTypeConfiguration<ApiToken>
{
    public void Configure(EntityTypeBuilder<ApiToken> builder)
    {
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(t => t.Name).IsRequired().HasMaxLength(100);
        builder.Property(t => t.Last4).IsRequired().HasMaxLength(8);
        builder.Property(t => t.CreatedAt).HasDefaultValueSql("now()");

        // SHA-256 hex = 64 ตัวเสมอ · unique เพราะ lookup ด้วยค่านี้ทุก request
        builder.Property(t => t.TokenHash).IsRequired().HasMaxLength(64);
        builder.HasIndex(t => t.TokenHash).IsUnique();

        // ⚠️ ไม่มี composite FK ไป pages เหมือนตารางอื่น เพราะนี่เป็นตารางระดับ
        //    identity ไม่ใช่เนื้อหาใน workspace — และ query filter ก็ไม่ใส่ด้วย
        //    (ดูเหตุผลใน AppDbContext) การ resolve token เกิดก่อนที่จะรู้ว่า
        //    workspace ไหน จึงกรองด้วย tenant filter ไม่ได้ตั้งแต่ต้น
        builder.HasOne(t => t.User)
               .WithMany()
               .HasForeignKey(t => t.UserId)
               .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<Workspace>()
               .WithMany()
               .HasForeignKey(t => t.WorkspaceId)
               .OnDelete(DeleteBehavior.Cascade);

        // รายการ token ของ workspace หนึ่ง เรียงใหม่ก่อน
        builder.HasIndex(t => new { t.WorkspaceId, t.CreatedAt });
    }
}

public class WorkspaceConfiguration : IEntityTypeConfiguration<Workspace>
{
    public void Configure(EntityTypeBuilder<Workspace> builder)
    {
        builder.HasKey(w => w.Id);
        builder.Property(w => w.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(w => w.Slug).IsRequired().HasMaxLength(60);
        builder.HasIndex(w => w.Slug).IsUnique();

        builder.Property(w => w.Name).IsRequired().HasMaxLength(200);
        builder.Property(w => w.Icon).HasMaxLength(200);
        builder.Property(w => w.CreatedAt).HasDefaultValueSql("now()");

        builder.HasIndex(w => w.DeletedAt);

        // ⚠️ global query filter "ไม่" อยู่ที่นี่ — อยู่ใน AppDbContext.OnModelCreating
        //    เพราะ filter ต้องอ่าน instance member ของ DbContext (CurrentWorkspaceId)
        //    ซึ่ง IEntityTypeConfiguration เข้าถึงไม่ได้ และการรวม filter ทุกตัวไว้
        //    ที่เดียวทำให้มีจุดเดียวที่ต้อง audit เรื่อง tenant isolation
    }
}

public class WorkspaceMemberConfiguration : IEntityTypeConfiguration<WorkspaceMember>
{
    public void Configure(EntityTypeBuilder<WorkspaceMember> builder)
    {
        builder.HasKey(m => new { m.WorkspaceId, m.UserId });

        builder.Property(m => m.Role)
               .HasConversion(RoleConverters.WorkspaceRole)
               .HasMaxLength(20)
               .IsRequired();

        builder.Property(m => m.JoinedAt).HasDefaultValueSql("now()");

        builder.HasOne(m => m.Workspace)
               .WithMany(w => w.Members)
               .HasForeignKey(m => m.WorkspaceId)
               .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(m => m.User)
               .WithMany(u => u.Memberships)
               .HasForeignKey(m => m.UserId)
               .OnDelete(DeleteBehavior.Cascade);

        // "workspace ของฉัน" — อ่านจากฝั่ง user
        builder.HasIndex(m => m.UserId);
    }
}

public class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).HasDefaultValueSql("gen_random_uuid()");

        // SHA-256 hex = 64 ตัวอักษร
        builder.Property(t => t.TokenHash).IsRequired().HasMaxLength(64);
        builder.HasIndex(t => t.TokenHash).IsUnique();

        builder.Property(t => t.CreatedAt).HasDefaultValueSql("now()");
        builder.Property(t => t.UserAgent).HasMaxLength(400);

        // varchar(45) ไม่ใช่ inet — Npgsql map string ไป inet ไม่ได้ (ต้องเป็น
        // System.Net.IPAddress) และเราไม่ได้ query แบบ subnet เลย จึงไม่คุ้มที่จะ
        // ลาก IPAddress เข้ามาใน model  (45 = ความยาวสูงสุดของ IPv6 แบบมี IPv4 ท้าย)
        builder.Property(t => t.IpAddress).HasMaxLength(45);

        builder.HasOne(t => t.User)
               .WithMany()
               .HasForeignKey(t => t.UserId)
               .OnDelete(DeleteBehavior.Cascade);

        // งานเก็บกวาด token ที่หมดอายุ
        builder.HasIndex(t => new { t.UserId, t.ExpiresAt });
    }
}
