using Microsoft.OpenApi;

namespace ProjectManagementAPI.Configurations;

// ═══════════════════════════════════════════════════════════════════════════
//  OpenAPI / Swagger — dev เท่านั้น (ดู Program.cs)
//
//  ⚠️ Microsoft.OpenApi 2.x (มากับ Swashbuckle 10) ย้าย type ออกจาก
//     namespace Microsoft.OpenApi.Models มาไว้ที่ Microsoft.OpenApi ตรง ๆ
//     และ security requirement ใช้ OpenApiSecuritySchemeReference แทนการ
//     สร้าง OpenApiSecurityScheme ที่มี Reference ข้างใน
//     ตัวอย่างเก่าจากยุค Swashbuckle 6 จะ compile ไม่ผ่าน
// ═══════════════════════════════════════════════════════════════════════════
public static class SwaggerConfiguration
{
    private const string SecuritySchemeId = "Bearer";

    public static IServiceCollection AddSwaggerDocumentation(this IServiceCollection services)
    {
        services.AddOpenApi();

        services.AddSwaggerGen(options =>
        {
            options.SwaggerDoc("v1", new OpenApiInfo
            {
                Title = "ProjectManagementAPI",
                Version = "v1",
                Description = "Self-hosted collaborative workspace — pages, databases, realtime"
            });

            // ปุ่ม Authorize ใน Swagger UI ให้แปะ bearer token ได้
            options.AddSecurityDefinition(SecuritySchemeId, new OpenApiSecurityScheme
            {
                Name = "Authorization",
                Type = SecuritySchemeType.Http,
                Scheme = "bearer",
                BearerFormat = "JWT",
                In = ParameterLocation.Header,
                Description = "ใส่ access token เฉย ๆ ไม่ต้องพิมพ์คำว่า Bearer"
            });

            // Swashbuckle 10 รับ Func<OpenApiDocument, …> เพื่อให้ reference
            // ผูกกับ host document ได้ (overload แบบรับ object ตรง ๆ ถูกถอดออก)
            options.AddSecurityRequirement(document => new OpenApiSecurityRequirement
            {
                [new OpenApiSecuritySchemeReference(SecuritySchemeId, document)] = []
            });
        });

        return services;
    }
}
