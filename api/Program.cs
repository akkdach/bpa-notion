using ProjectManagementAPI.Configurations;

namespace ProjectManagementAPI;

// ═══════════════════════════════════════════════════════════════════════════
//  Program — WIRING ONLY
//
//  ห้ามมี business logic ในไฟล์นี้ ทุก services.Add… ย้ายไป Configurations/
//  ตามลำดับที่อ่านแล้วเข้าใจได้: persistence → auth → realtime → app services
//
//  ดู PLAN.md "Engineering standards — Backend" ข้อ 7
// ═══════════════════════════════════════════════════════════════════════════
public class Program
{
    public static async Task Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // ─── Services ─────────────────────────────────────────────────────
        builder.Services.AddApiControllers();
        builder.Services.AddSwaggerDocumentation();
        builder.Services.AddCorsPolicy(builder.Configuration);
        builder.Services.AddPersistence(builder.Configuration);
        builder.Services.AddJwtAuthentication(builder.Configuration);
        builder.Services.AddRealtime();
        builder.Services.AddApplicationServices();

        var app = builder.Build();

        // ─── Middleware pipeline ──────────────────────────────────────────
        // ลำดับสำคัญ: CORS ต้องมาก่อน auth, และ tenant resolution ต้องมาหลัง
        // auth เพราะมันอ่าน workspace_id จาก claim
        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
            app.UseSwagger();
            app.UseSwaggerUI(options =>
            {
                options.SwaggerEndpoint("/openapi/v1.json", "ProjectManagementAPI v1");
                options.RoutePrefix = string.Empty; // Swagger ที่ root "/"
            });
        }

        // ไม่มี UseHttpsRedirection() โดยเจตนา — container ฟัง HTTP ธรรมดา
        // และ TLS ถูก terminate ที่ nginx/reverse proxy ข้างหน้า ถ้าเปิดไว้
        // health check ภายใน network จะถูก 307 redirect แล้ว fail
        app.UseCors(CorsConfiguration.PolicyName);
        app.UseAuthentication();
        app.UseAuthorization();

        app.MapControllers();
        app.MapRealtimeHubs();

        await app.RunAsync();
    }
}
