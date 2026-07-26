using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Data;

// ═══════════════════════════════════════════════════════════════════════════
//  AppDbContext
//
//  ⚠️ นี่คือจุดที่ tenant isolation ถูกบังคับใช้ หรือหลุด
//     global query filter ทุกตัวอยู่ในไฟล์นี้ที่เดียว (ไม่กระจายไปอยู่ใน
//     EntityConfigurations/) เพื่อให้มีจุดเดียวที่ต้อง review
// ═══════════════════════════════════════════════════════════════════════════
public class AppDbContext(
    DbContextOptions<AppDbContext> options,
    ITenantContext tenant) : DbContext(options)
{
    // ─────────────────────────────────────────────────────────────────────
    //  ⚠️ ต้องเป็น property ที่อ่านค่าใหม่ทุกครั้ง ไม่ใช่ค่าที่ capture ไว้
    //
    //  ถ้าเขียน filter โดย capture ค่าคงที่ (เช่น `var ws = tenant.WorkspaceId`
    //  แล้วใช้ ws ใน lambda) EF จะ "อบ" ค่านั้นลงใน compiled query ที่ cache ไว้
    //  แล้ว request ถัดไปของ workspace อื่นจะใช้ค่าเดิม = tenant leak
    //
    //  การอ่านผ่าน property ทำให้ EF มองเป็น parameter และ parameterise ให้
    // ─────────────────────────────────────────────────────────────────────
    public Guid? CurrentWorkspaceId => tenant.WorkspaceId;

    // ─── identity ────────────────────────────────────────────────────────
    public DbSet<User> Users => Set<User>();
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    // ─── pages ───────────────────────────────────────────────────────────
    public DbSet<Page> Pages => Set<Page>();
    public DbSet<PageAcl> PageAcls => Set<PageAcl>();

    // ─── Yjs + search ────────────────────────────────────────────────────
    public DbSet<PageDocUpdate> PageDocUpdates => Set<PageDocUpdate>();
    public DbSet<PageDocSnapshot> PageDocSnapshots => Set<PageDocSnapshot>();
    public DbSet<PageSearch> PageSearches => Set<PageSearch>();
    public DbSet<PageLink> PageLinks => Set<PageLink>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // mapping ทั้งหมดอยู่ใน Data/EntityConfigurations/*.cs แล้ว auto-discover
        // ที่นี่ — กัน OnModelCreating ไม่ให้บวมเป็นพันบรรทัด
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        ConfigureGlobalFilters(modelBuilder);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Global query filters — ทั้งหมดอยู่ที่นี่
    //
    //  EF Core 10 รองรับ "named" filter ซึ่งเป็นเหตุผลที่ดีไซน์นี้สะอาด:
    //  หน้า trash เรียก IgnoreQueryFilters(["SoftDelete"]) ได้โดย Tenant filter
    //  ยังทำงานอยู่
    //
    //  ก่อน EF 10 ทำแบบนี้ไม่ได้ — IgnoreQueryFilters() ปิดทุกตัวพร้อมกัน
    //  ซึ่งเป็นวิธีที่ tenant leak หลุดขึ้น production
    //
    //  ❌ IgnoreQueryFilters() แบบไม่มี argument = CI build fail
    //     (ยกเว้นใน IdentityQueries.cs ที่ตั้งใจข้าม tenant filter)
    // ═══════════════════════════════════════════════════════════════════════
    public const string TenantFilter = "Tenant";
    public const string SoftDeleteFilter = "SoftDelete";

    private void ConfigureGlobalFilters(ModelBuilder modelBuilder)
    {
        // ─── ตารางที่ผูกกับ workspace ─────────────────────────────────────
        modelBuilder.Entity<Page>()
            .HasQueryFilter(TenantFilter, p => p.WorkspaceId == CurrentWorkspaceId)
            .HasQueryFilter(SoftDeleteFilter, p => p.DeletedAt == null);

        modelBuilder.Entity<PageAcl>()
            .HasQueryFilter(TenantFilter, a => a.WorkspaceId == CurrentWorkspaceId);

        modelBuilder.Entity<PageDocUpdate>()
            .HasQueryFilter(TenantFilter, u => u.WorkspaceId == CurrentWorkspaceId);

        modelBuilder.Entity<PageDocSnapshot>()
            .HasQueryFilter(TenantFilter, s => s.WorkspaceId == CurrentWorkspaceId);

        modelBuilder.Entity<PageSearch>()
            .HasQueryFilter(TenantFilter, s => s.WorkspaceId == CurrentWorkspaceId);

        modelBuilder.Entity<PageLink>()
            .HasQueryFilter(TenantFilter, l => l.WorkspaceId == CurrentWorkspaceId);

        modelBuilder.Entity<WorkspaceMember>()
            .HasQueryFilter(TenantFilter, m => m.WorkspaceId == CurrentWorkspaceId);

        // ─── workspace เอง ────────────────────────────────────────────────
        // filter บน Id เพราะตารางนี้ "คือ" tenant
        // การอ่าน "workspace ทั้งหมดของฉัน" ข้าม filter นี้โดยเจตนาผ่าน
        // IdentityQueries — เป็นที่เดียวในระบบที่ทำได้
        modelBuilder.Entity<Workspace>()
            .HasQueryFilter(TenantFilter, w => w.Id == CurrentWorkspaceId)
            .HasQueryFilter(SoftDeleteFilter, w => w.DeletedAt == null);

        // ─── ไม่มี filter โดยเจตนา ────────────────────────────────────────
        // User และ RefreshToken เป็นข้อมูลระดับ identity ไม่ผูก workspace
        // เข้าถึงด้วย predicate ที่ระบุ user ชัดเจนเสมอ (login, refresh, /me)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  updated_at อัตโนมัติ — ลืมเซ็ตเองได้ง่ายและตรวจไม่เจอ
    // ═══════════════════════════════════════════════════════════════════════
    public override int SaveChanges()
    {
        StampUpdatedAt();
        return base.SaveChanges();
    }

    public override Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        StampUpdatedAt();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void StampUpdatedAt()
    {
        var now = DateTimeOffset.UtcNow;

        foreach (var entry in ChangeTracker.Entries<Page>())
        {
            if (entry.State is EntityState.Added or EntityState.Modified)
            {
                entry.Entity.UpdatedAt = now;
            }
        }
    }
}
