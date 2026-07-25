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
        // ─── Repositories ────────────────────────────────────────────────
        // ที่เดียวที่แตะ AppDbContext ได้ (บังคับด้วย CI gate)
        services.AddScoped<IHealthRepository, HealthRepository>();

        // Phase 1
        // services.AddScoped<IUserRepository, UserRepository>();
        // services.AddScoped<IWorkspaceRepository, WorkspaceRepository>();
        // services.AddScoped<IPageRepository, PageRepository>();

        // ─── Services ────────────────────────────────────────────────────
        // Phase 1
        // services.AddScoped<ITenantContext, TenantContext>();
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
