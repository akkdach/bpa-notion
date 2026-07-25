using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  JWT + refresh token
// ═══════════════════════════════════════════════════════════════════════════
public class TokenService : ITokenService
{
    private readonly SigningCredentials _credentials;
    private readonly string _issuer;
    private readonly TimeSpan _accessLifetime;

    public TimeSpan RefreshTokenLifetime { get; }

    public TokenService(IConfiguration configuration)
    {
        var key = configuration["Jwt:Key"]
            ?? throw new InvalidOperationException("Jwt:Key ไม่ได้ตั้งค่า");

        _issuer = configuration["Jwt:Issuer"]
            ?? throw new InvalidOperationException("Jwt:Issuer ไม่ได้ตั้งค่า");

        _credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);

        _accessLifetime = ParseDuration(configuration["Jwt:ExpiresIn"], TimeSpan.FromHours(24));
        RefreshTokenLifetime = ParseDuration(configuration["Jwt:RefreshExpiresIn"], TimeSpan.FromDays(30));
    }

    public AccessToken CreateAccessToken(User user)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresAt = now.Add(_accessLifetime);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(JwtRegisteredClaimNames.Name, user.Name),
            // jti ทำให้ revoke token ใบเดียวได้ในอนาคต (Phase 9)
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _issuer,
            claims: claims,
            notBefore: now.UtcDateTime,
            expires: expiresAt.UtcDateTime,
            signingCredentials: _credentials);

        return new AccessToken(new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }

    public RefreshTokenPair CreateRefreshToken()
    {
        // 256 bit จาก CSPRNG — เดาไม่ได้ ไม่ต้องมีโครงสร้าง
        var bytes = RandomNumberGenerator.GetBytes(32);
        var token = Base64UrlEncoder.Encode(bytes);

        return new RefreshTokenPair(
            token,
            HashRefreshToken(token),
            DateTimeOffset.UtcNow.Add(RefreshTokenLifetime));
    }

    // ─────────────────────────────────────────────────────────────────────
    //  SHA-256 ไม่ใช่ bcrypt
    //
    //  ตั้งใจ: ต้อง lookup แถวในฐานด้วยค่านี้ จึงต้อง deterministic ซึ่ง bcrypt
    //  (ที่ salt ต่างกันทุกครั้ง) ทำไม่ได้ — ต้องดึงทุกแถวมา verify ทีละใบ
    //
    //  ปลอดภัยพอเพราะ token เป็น random 256 bit ไม่ใช่รหัสผ่านที่คนตั้ง
    //  ไม่มี dictionary ให้ brute force
    // ─────────────────────────────────────────────────────────────────────
    public string HashRefreshToken(string token)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>
    /// แปลง "24h" / "30d" / "45m" / "90s" เป็น TimeSpan
    /// รูปแบบนี้ตรงกับ convention ของโปรเจกต์อื่น (JWT_EXPIRES_IN=24h)
    /// </summary>
    internal static TimeSpan ParseDuration(string? value, TimeSpan fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;

        var text = value.Trim();
        var unit = char.ToLowerInvariant(text[^1]);

        if (!char.IsLetter(unit))
        {
            // ไม่มีหน่วย — ตีความเป็นวินาที
            return int.TryParse(text, out var seconds) && seconds > 0
                ? TimeSpan.FromSeconds(seconds)
                : fallback;
        }

        if (!int.TryParse(text[..^1], out var amount) || amount <= 0) return fallback;

        return unit switch
        {
            's' => TimeSpan.FromSeconds(amount),
            'm' => TimeSpan.FromMinutes(amount),
            'h' => TimeSpan.FromHours(amount),
            'd' => TimeSpan.FromDays(amount),
            _ => fallback
        };
    }
}

/// <summary>
/// ชื่อ claim แบบสั้นตามมาตรฐาน JWT
///
/// ⚠️ ไม่ใช้ ClaimTypes.* ของ .NET เพราะมันเป็น URI ยาว ๆ
///    (http://schemas.xmlsoap.org/…/nameidentifier) ซึ่งทำให้ token ใหญ่ขึ้นมาก
///    และฝั่ง TypeScript อ่านยาก
/// </summary>
internal static class JwtRegisteredClaimNames
{
    public const string Sub = "sub";
    public const string Email = "email";
    public const string Name = "name";
    public const string Jti = "jti";
}
