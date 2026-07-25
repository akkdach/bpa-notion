using FluentValidation;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Repositories;
using ProjectManagementAPI.Repositories.Abstractions;
using ProjectManagementAPI.Services;
using ProjectManagementAPI.Services.Abstractions;

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

        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IWorkspaceRepository, WorkspaceRepository>();
        services.AddScoped<IPageRepository, PageRepository>();
        services.AddScoped<IPermissionQueries, PermissionQueries>();
        services.AddScoped<IDocUpdateRepository, DocUpdateRepository>();

        // ─── Services ────────────────────────────────────────────────────
        services.AddSingleton<IPasswordHasher, PasswordHasher>();
        services.AddSingleton<ITokenService, TokenService>();
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IWorkspaceService, WorkspaceService>();

        // ⚠️ PermissionService ต้องเป็น scoped เท่านั้น — มัน memo คำตอบไว้ใน
        //    instance ถ้าเป็น singleton จะเอาสิทธิ์ของ user คนหนึ่งไปตอบ
        //    request ของอีกคน
        services.AddScoped<IPermissionService, PermissionService>();
        services.AddScoped<IPageTreeService, PageTreeService>();
        services.AddScoped<IDocumentService, DocumentService>();

        // ─── Validators ──────────────────────────────────────────────────
        // scan assembly หา AbstractValidator<T> ทั้งหมด — validator ใหม่ไม่ต้อง
        // มาลงทะเบียนที่นี่ ซึ่งเป็นขั้นที่ลืมได้และลืมแล้วไม่มีอะไรฟ้อง
        services.AddValidatorsFromAssemblyContaining<Program>(ServiceLifetime.Singleton);

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
