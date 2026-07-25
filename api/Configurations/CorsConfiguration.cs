namespace ProjectManagementAPI.Configurations;

// ═══════════════════════════════════════════════════════════════════════════
//  CORS
//
//  ⚠️ ห้ามใช้ AllowAnyOrigin() เด็ดขาด
//     SignalR ต้องมี AllowCredentials() และ ASP.NET Core จะ throw ตอน runtime
//     ทันทีที่ AllowAnyOrigin() + AllowCredentials() อยู่ด้วยกัน
//
//  ปกติ nginx proxy /api และ /hubs ให้อยู่แล้ว เบราว์เซอร์จึงเห็น origin เดียว
//  และ CORS ไม่ทำงานเลย config นี้มีไว้สำหรับ `npm run dev` (localhost:5173)
//  และกรณีที่ web กับ api อยู่คนละ host
// ═══════════════════════════════════════════════════════════════════════════
public static class CorsConfiguration
{
    public const string PolicyName = "AppCors";

    public static IServiceCollection AddCorsPolicy(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var origins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
                      ?? [];

        if (origins.Length == 0)
        {
            throw new InvalidOperationException(
                "Cors:AllowedOrigins is empty. ตั้งค่า WEB_ORIGIN ใน .env " +
                "(เช่น http://localhost) — ปล่อยว่างไม่ได้ เพราะ AllowAnyOrigin " +
                "ใช้ร่วมกับ SignalR ไม่ได้");
        }

        services.AddCors(options =>
        {
            options.AddPolicy(PolicyName, policy => policy
                .WithOrigins(origins)
                .AllowAnyMethod()
                .AllowAnyHeader()
                .AllowCredentials());   // จำเป็นสำหรับ SignalR + refresh-token cookie
        });

        return services;
    }
}
