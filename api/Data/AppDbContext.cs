using Microsoft.EntityFrameworkCore;

namespace ProjectManagementAPI.Data;

// ═══════════════════════════════════════════════════════════════════════════
//  AppDbContext
//
//  ⚠️ นี่คือจุดที่ tenant isolation ถูกบังคับใช้ หรือหลุด
//
//  Phase 1 จะเพิ่ม named query filter ของ EF Core 10:
//
//      modelBuilder.Entity<Page>()
//          .HasQueryFilter("Tenant",     p => p.WorkspaceId == CurrentWorkspaceId)
//          .HasQueryFilter("SoftDelete", p => p.DeletedAt == null);
//
//  named filter เป็นของใหม่ใน EF 10 และเป็นเหตุผลที่ดีไซน์นี้สะอาด:
//  หน้า trash เรียก IgnoreQueryFilters(["SoftDelete"]) ได้โดย tenant filter
//  ยังทำงานอยู่ ก่อน EF 10 ทำแบบนี้ไม่ได้ — IgnoreQueryFilters() ปิดทุกตัว
//  พร้อมกัน ซึ่งเป็นวิธีที่ tenant leak หลุดขึ้น production
//
//  ❌ IgnoreQueryFilters() แบบไม่มี argument = CI build fail
//     (ยกเว้นใน IdentityQueries.cs ที่ตั้งใจข้าม tenant filter)
// ═══════════════════════════════════════════════════════════════════════════
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    // ─── Phase 1 ──────────────────────────────────────────────────────────
    // public DbSet<User> Users => Set<User>();
    // public DbSet<Workspace> Workspaces => Set<Workspace>();
    // public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();
    // public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    // public DbSet<Page> Pages => Set<Page>();

    // ─── Phase 2 ──────────────────────────────────────────────────────────
    // public DbSet<PageDocUpdate> PageDocUpdates => Set<PageDocUpdate>();
    // public DbSet<PageDocSnapshot> PageDocSnapshots => Set<PageDocSnapshot>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // entity configuration ทั้งหมดอยู่ใน Data/EntityConfigurations/*.cs
        // แล้ว auto-discover ที่นี่ — กัน OnModelCreating ไม่ให้บวมเป็นพันบรรทัด
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
