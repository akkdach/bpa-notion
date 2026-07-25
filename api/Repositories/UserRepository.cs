using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Repositories;

// ═══════════════════════════════════════════════════════════════════════════
//  UserRepository
//
//  users และ refresh_tokens ไม่มี tenant filter อยู่แล้ว (เป็นข้อมูลระดับ
//  identity) จึงไม่ต้องเรียก IgnoreQueryFilters ที่ไหนในไฟล์นี้
// ═══════════════════════════════════════════════════════════════════════════
public class UserRepository(AppDbContext db, ILogger<UserRepository> logger) : IUserRepository
{
    public Task<bool> EmailExistsAsync(string email, CancellationToken ct = default)
        // คอลัมน์เป็น citext — การเทียบไม่สนตัวพิมพ์อยู่แล้ว
        => db.Users.AnyAsync(u => u.Email == email, ct);

    public async Task<User> AddAsync(User user, CancellationToken ct = default)
    {
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        return user;
    }

    public Task<User?> GetByIdAsync(Guid userId, CancellationToken ct = default)
        => db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);

    public Task TouchLastLoginAsync(Guid userId, CancellationToken ct = default)
        // ExecuteUpdate — ไม่ต้องโหลด entity มาทั้งตัวเพื่อแก้ฟิลด์เดียว
        => db.Users
             .Where(u => u.Id == userId)
             .ExecuteUpdateAsync(s => s.SetProperty(u => u.LastLoginAt, DateTimeOffset.UtcNow), ct);

    public async Task AddRefreshTokenAsync(RefreshToken token, CancellationToken ct = default)
    {
        db.RefreshTokens.Add(token);
        await db.SaveChangesAsync(ct);
    }

    public Task<RefreshToken?> FindRefreshTokenWithUserAsync(
        string tokenHash, CancellationToken ct = default)
        => db.RefreshTokens
             .Include(t => t.User)
             .FirstOrDefaultAsync(t => t.TokenHash == tokenHash, ct);

    public Task RotateRefreshTokenAsync(
        RefreshToken current, RefreshToken replacement, CancellationToken ct = default)
        // ต้องอยู่ใน transaction เดียว — ถ้าใบใหม่ถูกบันทึกแต่ใบเก่าไม่ถูกยกเลิก
        // จะมี token ใช้งานได้สองใบพร้อมกัน ซึ่งทำให้ตรวจจับการรั่วไม่ได้
        //
        // ⚠️ ต้องผ่าน InTransactionAsync ไม่ใช่ BeginTransactionAsync ตรง ๆ
        //    เพราะเราเปิด EnableRetryOnFailure ไว้ ดู Data/TransactionExtensions.cs
        => db.InTransactionAsync(async token =>
        {
            db.RefreshTokens.Add(replacement);
            await db.SaveChangesAsync(token);

            current.RevokedAt = DateTimeOffset.UtcNow;
            current.ReplacedByTokenId = replacement.Id;
            await db.SaveChangesAsync(token);
        }, ct);

    public async Task RevokeAllForUserAsync(
        Guid userId, string reason, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;

        var affected = await db.RefreshTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);

        // log ระดับ Warning เพราะการเรียก method นี้แปลว่าเจอสิ่งผิดปกติเสมอ
        logger.LogWarning(
            "ยกเลิก refresh token {Count} ใบของ user {UserId} — เหตุผล: {Reason}",
            affected, userId, reason);
    }
}
