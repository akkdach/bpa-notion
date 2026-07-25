using ProjectManagementAPI.Data;
using ProjectManagementAPI.Repositories;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Configurations;

// ═══════════════════════════════════════════════════════════════════════════
//  DI registration ทั้งหมดอยู่ที่นี่
//
//  ทุก service และ repository ต้องมี interface — ไม่ใช่พิธีกรรม แต่เพราะ
//  tenant-isolation test suite กับ unit test ของ formula engine ต้องสลับ
//  implementation ได้ ถ้าไม่มี interface จะเขียน test พวกนั้นไม่ได้เลย
// ═══════════════════════════════════════════════════════════════════════════
public static class ApplicationServicesConfiguration
{
    public static IServiceCollection AddApplicationServices(this IServiceCollection services)
    {
        // ─── Tenant context ──────────────────────────────────────────────
        // instance เดียวต่อ request — ทั้ง ITenantContext (อ่าน) และ
        // ITenantContextSetter (เขียน) ต้องชี้ไปที่ object เดียวกัน ไม่งั้น
        // middleware จะเซ็ตค่าใส่ instance ที่ DbContext ไม่ได้เห็น
        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());
        services.AddScoped<ITenantContextSetter>(sp => sp.GetRequiredService<TenantContext>());

        // ทางเดียวที่ข้าม Tenant filter ได้โดยเจตนา
        services.AddScoped<IIdentityQueries, IdentityQueries>();

        // ทางเดียวที่ raw SQL ควรวิ่งผ่าน (บังคับใส่ workspace_id ให้)
        services.AddScoped<IScopedSql, ScopedSql>();

        // ─── Repositories ────────────────────────────────────────────────
        // ที่เดียวที่แตะ AppDbContext ได้ (บังคับด้วย CI gate)
        services.AddScoped<IHealthRepository, HealthRepository>();

        // Phase 1 — เติมทีละ stage
        // services.AddScoped<IUserRepository, UserRepository>();
        // services.AddScoped<IWorkspaceRepository, WorkspaceRepository>();
        // services.AddScoped<IPageRepository, PageRepository>();

        // ─── Services ────────────────────────────────────────────────────
        // services.AddScoped<ITokenService, TokenService>();
        // services.AddSingleton<IPasswordHasher, PasswordHasher>();
        // services.AddScoped<IPermissionService, PermissionService>();
        // services.AddScoped<IPageTreeService, PageTreeService>();

        // ─── Property-type strategies (Phase 4a) ─────────────────────────
        // ลงทะเบียนเป็น IEnumerable<IPropertyTypeHandler> แล้วให้
        // PropertyTypeRegistry resolve ตาม Type — เพิ่ม property type ใหม่
        // = คลาสใหม่ 1 ไฟล์ ไม่ต้องแก้ที่อื่น
        //
        // services.AddSingleton<IPropertyTypeHandler, TextPropertyHandler>();
        // services.AddSingleton<IPropertyTypeHandler, NumberPropertyHandler>();
        // … (~20 ตัว)
        // services.AddSingleton<IPropertyTypeRegistry, PropertyTypeRegistry>();

        return services;
    }
}
