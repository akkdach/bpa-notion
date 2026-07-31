using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using ProjectManagementAPI.Services;

namespace ProjectManagementAPI.Configurations;

// ═══════════════════════════════════════════════════════════════════════════
//  ยืนยันตัวตน — รับสองแบบผ่าน Authorization header เดียวกัน
//
//    · JWT       สำหรับเบราว์เซอร์ (อายุ 24 ชม. ได้จาก /auth/login)
//    · API token สำหรับเครื่องภายนอกอย่าง MCP (ขึ้นต้น `pmt_` ไม่มีวันหมดอายุ
//                เว้นแต่ตั้งไว้ เพิกถอนได้รายใบ)
// ═══════════════════════════════════════════════════════════════════════════
public static class AuthConfiguration
{
    /// <summary>path prefix ของ SignalR hub — ใช้ตัดสินว่าจะรับ token จาก query string</summary>
    private const string HubPathPrefix = "/hubs";

    /// <summary>scheme ที่ทำหน้าที่เลือกทางอย่างเดียว ไม่ได้ตรวจเอง</summary>
    private const string RouteScheme = "PmAuth";

    private const string ApiTokenPrefix = TokenService.ApiTokenPrefix;

    public static IServiceCollection AddJwtAuthentication(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var key = configuration["Jwt:Key"];
        var issuer = configuration["Jwt:Issuer"]
            ?? throw new InvalidOperationException("Jwt:Issuer ไม่ได้ตั้งค่า");

        // ⚠️ appsettings.json ประกาศ Jwt:Key ไว้เป็นสตริงว่าง ค่าที่ได้จึงเป็น ""
        //    ไม่ใช่ null — ถ้าเช็คแค่ `?? throw` จะตกไปโดนเงื่อนไข "สั้นเกินไป"
        //    ข้างล่าง แล้วได้ error ที่ชี้ผิดทาง
        if (string.IsNullOrWhiteSpace(key))
        {
            throw new InvalidOperationException(
                "Jwt:Key ไม่ได้ตั้งค่า — " +
                "dev: รัน `pwsh scripts/setup-secrets.ps1` (หรือ `bash scripts/setup-secrets.sh`) | " +
                "Docker: ตรวจ JWT_SECRET ใน .env");
        }

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
                // ─────────────────────────────────────────────────────────
                //  scheme หลักเป็น "ตัวเลือกทาง" ไม่ใช่ตัวตรวจเอง
                //
                //  ระบบรับสองแบบผ่าน header เดียวกัน:
                //    · JWT       — เบราว์เซอร์ (ได้มาจาก /auth/login)
                //    · API token — เครื่องภายนอกอย่าง MCP (ขึ้นต้น pmt_)
                //
                //  แยกด้วย prefix ไม่ใช่ด้วยการ "ลอง parse JWT ก่อนแล้วค่อย
                //  fallback" เพราะแบบหลังทำให้ทุก API token เสียเวลาไปกับการ
                //  พยายาม validate JWT ที่ล้มเหลวแน่นอน และ log จะเต็มไปด้วย
                //  ข้อความ token ผิดรูปที่ไม่ใช่ปัญหาจริง
                // ─────────────────────────────────────────────────────────
                options.DefaultScheme = RouteScheme;
                options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            })
            .AddPolicyScheme(RouteScheme, RouteScheme, options =>
            {
                options.ForwardDefaultSelector = context =>
                {
                    var header = context.Request.Headers.Authorization.ToString();

                    return header.StartsWith(
                        $"Bearer {ApiTokenPrefix}", StringComparison.OrdinalIgnoreCase)
                        ? ApiTokenAuthenticationHandler.SchemeName
                        : JwtBearerDefaults.AuthenticationScheme;
                };
            })
            .AddScheme<AuthenticationSchemeOptions, ApiTokenAuthenticationHandler>(
                ApiTokenAuthenticationHandler.SchemeName, _ => { })
            .AddJwtBearer(options =>
            {
                // ─────────────────────────────────────────────────────────
                //  ปิด inbound claim mapping
                //
                //  ค่า default ของ .NET จะ "แปลง" claim สั้น ๆ ของ JWT ให้เป็น
                //  URI ยาวของ WS-Federation เช่น sub → ClaimTypes.NameIdentifier
                //  (http://schemas.xmlsoap.org/ws/2005/05/identity/claims/…)
                //  แล้วโค้ดที่หา User.FindFirst("sub") จะได้ null ทั้งที่ token
                //  มี sub อยู่ — เป็นความสับสนที่เสียเวลา debug มาก
                // ─────────────────────────────────────────────────────────
                options.MapInboundClaims = false;

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
