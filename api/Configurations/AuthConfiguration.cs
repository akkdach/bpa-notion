using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

namespace ProjectManagementAPI.Configurations;

// ═══════════════════════════════════════════════════════════════════════════
//  JWT bearer authentication
// ═══════════════════════════════════════════════════════════════════════════
public static class AuthConfiguration
{
    /// <summary>path prefix ของ SignalR hub — ใช้ตัดสินว่าจะรับ token จาก query string</summary>
    private const string HubPathPrefix = "/hubs";

    public static IServiceCollection AddJwtAuthentication(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var key = configuration["Jwt:Key"]
            ?? throw new InvalidOperationException("Jwt:Key ไม่ได้ตั้งค่า (JWT_SECRET ใน .env)");
        var issuer = configuration["Jwt:Issuer"]
            ?? throw new InvalidOperationException("Jwt:Issuer ไม่ได้ตั้งค่า");

        // HMAC-SHA256 ต้องมี key >= 256 bit ถ้าสั้นกว่านี้ ASP.NET Core จะ throw
        // ตอน request แรก ไม่ใช่ตอน startup — ดักไว้ที่นี่ให้ fail เร็ว
        if (Encoding.UTF8.GetByteCount(key) < 32)
        {
            throw new InvalidOperationException(
                "Jwt:Key สั้นเกินไป ต้องอย่างน้อย 32 bytes สำหรับ HMAC-SHA256 " +
                "(สร้างใหม่: openssl rand -base64 48)");
        }

        services
            .AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            })
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = issuer,
                    ValidAudience = issuer,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
                    ClockSkew = TimeSpan.Zero
                };

                options.Events = new JwtBearerEvents
                {
                    // ─────────────────────────────────────────────────────────
                    //  เบราว์เซอร์ตั้ง header บน WebSocket handshake ไม่ได้
                    //  จึงต้องรับ token ผ่าน query string — เป็น pattern ที่
                    //  ASP.NET Core documented ไว้เอง
                    //
                    //  จำกัดไว้แค่ path /hubs เท่านั้น เพื่อไม่ให้ REST endpoint
                    //  ยอมรับ token ผ่าน URL (ซึ่งจะไปโผล่ใน access log และ
                    //  browser history)
                    // ─────────────────────────────────────────────────────────
                    OnMessageReceived = context =>
                    {
                        var accessToken = context.Request.Query["access_token"];

                        if (!string.IsNullOrEmpty(accessToken) &&
                            context.HttpContext.Request.Path.StartsWithSegments(HubPathPrefix))
                        {
                            context.Token = accessToken;
                        }

                        return Task.CompletedTask;
                    }
                };
            });

        services.AddAuthorization();

        return services;
    }
}
