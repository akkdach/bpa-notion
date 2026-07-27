using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Repositories.Abstractions;

public interface IUserRepository
{
    Task<bool> EmailExistsAsync(string email, CancellationToken ct = default);
    Task<User> AddAsync(User user, CancellationToken ct = default);
    Task<User?> GetByIdAsync(Guid userId, CancellationToken ct = default);
    Task TouchLastLoginAsync(Guid userId, CancellationToken ct = default);

    /// <summary>
    /// ตั้งว่าบัญชีนี้เป็นของคนหรือของ AI — owner/admin เท่านั้นที่เรียกถึง
    /// (ตรวจสิทธิ์อยู่ที่ WorkspaceService ไม่ใช่ที่นี่)
    /// </summary>
    Task UpdateKindAsync(Guid userId, UserKind kind, CancellationToken ct = default);

    // ─── refresh token ───────────────────────────────────────────────────
    Task AddRefreshTokenAsync(RefreshToken token, CancellationToken ct = default);

    /// <summary>หา refresh token จาก hash — ดึง user มาด้วยเพื่อไม่ต้อง query สองรอบ</summary>
    Task<RefreshToken?> FindRefreshTokenWithUserAsync(string tokenHash, CancellationToken ct = default);

    /// <summary>rotate: ยกเลิกใบเก่าและชี้ไปที่ใบใหม่ในทรานแซกชันเดียว</summary>
    Task RotateRefreshTokenAsync(
        RefreshToken current, RefreshToken replacement, CancellationToken ct = default);

    /// <summary>
    /// ยกเลิก token ทุกใบของ user — ใช้เมื่อตรวจพบการใช้ token ที่ถูก rotate แล้วซ้ำ
    /// ซึ่งเป็นสัญญาณว่า token รั่ว
    /// </summary>
    Task RevokeAllForUserAsync(Guid userId, string reason, CancellationToken ct = default);
}
