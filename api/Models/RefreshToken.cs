namespace ProjectManagementAPI.Models;

/// <summary>
/// refresh token — เก็บเฉพาะ hash ไม่เก็บ token จริง
/// ถ้าฐานข้อมูลรั่ว ผู้ที่ได้ไปยังสวมสิทธิ์ไม่ได้
/// </summary>
public class RefreshToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }

    /// <summary>SHA-256 ของ token (ไม่ใช้ bcrypt — ต้อง lookup ด้วยค่านี้ จึงต้อง deterministic)</summary>
    public string TokenHash { get; set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>token ที่ออกแทนตัวนี้ตอน rotate — ใช้ตรวจจับการใช้ token ซ้ำ</summary>
    public Guid? ReplacedByTokenId { get; set; }

    public string? UserAgent { get; set; }
    public string? IpAddress { get; set; }

    public User? User { get; set; }

    public bool IsActive(DateTimeOffset now) => RevokedAt is null && ExpiresAt > now;
}
