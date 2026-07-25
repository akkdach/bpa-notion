using ProjectManagementAPI.Data;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Mapping;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;
using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  AuthService
//
//  register / login / refresh / logout — ไม่มีอีเมลยืนยัน ไม่มี SSO
//  (ตามที่ตกลงไว้: email + password + JWT เท่านั้น)
// ═══════════════════════════════════════════════════════════════════════════
public class AuthService(
    IUserRepository users,
    IIdentityQueries identity,
    IPasswordHasher hasher,
    ITokenService tokens,
    ILogger<AuthService> logger) : IAuthService
{
    public async Task<Result<AuthResponse>> RegisterAsync(
        RegisterRequest request, ClientInfo client, CancellationToken ct = default)
    {
        var email = NormalizeEmail(request.Email);

        if (await users.EmailExistsAsync(email, ct))
        {
            // ─────────────────────────────────────────────────────────────
            //  ตรงนี้บอกตรง ๆ ว่าอีเมลถูกใช้แล้ว = เปิดเผยว่ามีบัญชีนี้อยู่
            //
            //  ยอมรับ trade-off นี้เพราะทางเลือกอื่น (ตอบสำเร็จปลอม ๆ แล้วส่ง
            //  อีเมลแจ้ง) ต้องมี SMTP ซึ่งไม่มีในระบบนี้ และการไม่บอกทำให้
            //  ผู้ใช้ที่ลืมว่าสมัครแล้วติดอยู่โดยไม่รู้สาเหตุ
            //
            //  ผลกระทบจำกัด: นี่คือ workspace ภายในองค์กร ไม่ใช่บริการสาธารณะ
            //  ที่การมีบัญชีอยู่เป็นความลับ
            // ─────────────────────────────────────────────────────────────
            return Error.Conflict("อีเมลนี้ถูกใช้แล้ว", "email_taken");
        }

        var user = await users.AddAsync(new User
        {
            Email = email,
            PasswordHash = hasher.Hash(request.Password),
            Name = request.Name.Trim(),
            Locale = "th"
        }, ct);

        logger.LogInformation("สมัครสมาชิกใหม่ {UserId}", user.Id);

        return await IssueTokensAsync(user, client, workspaces: [], ct);
    }

    public async Task<Result<AuthResponse>> LoginAsync(
        LoginRequest request, ClientInfo client, CancellationToken ct = default)
    {
        var email = NormalizeEmail(request.Email);
        var user = await identity.FindUserByEmailAsync(email, ct);

        // ─────────────────────────────────────────────────────────────────
        //  ยังคงเทียบรหัสผ่านแม้ไม่พบ user
        //
        //  ถ้า return ทันทีตอนไม่พบ อีเมลที่ไม่มีในระบบจะตอบเร็วกว่าอีเมลที่มี
        //  อย่างชัดเจน (bcrypt work factor 12 ≈ 300ms) ซึ่งพอจะไล่หารายชื่อ
        //  อีเมลที่มีอยู่ในระบบได้จากเวลาตอบสนองล้วน ๆ
        // ─────────────────────────────────────────────────────────────────
        if (user is null)
        {
            _ = hasher.Verify(request.Password, DummyHash);
            return InvalidCredentials;
        }

        if (!hasher.Verify(request.Password, user.PasswordHash))
        {
            // ข้อความเดียวกันทั้งสองกรณี — ไม่บอกว่าอีเมลผิดหรือรหัสผิด
            return InvalidCredentials;
        }

        await users.TouchLastLoginAsync(user.Id, ct);

        var memberships = await identity.ListMembershipsAsync(user.Id, ct);

        return await IssueTokensAsync(
            user, client, memberships.Select(m => m.ToSummaryDto()).ToList(), ct);
    }

    public async Task<Result<AuthResponse>> RefreshAsync(
        string refreshToken, ClientInfo client, CancellationToken ct = default)
    {
        var hash = tokens.HashRefreshToken(refreshToken);
        var stored = await users.FindRefreshTokenWithUserAsync(hash, ct);

        if (stored?.User is null)
        {
            return Error.Unauthorized("refresh token ไม่ถูกต้อง", "invalid_refresh_token");
        }

        // ─────────────────────────────────────────────────────────────────
        //  ตรวจการใช้ token ที่ rotate แล้วซ้ำ
        //
        //  ถ้ามีคนเอา token ที่ถูกยกเลิกแล้วมาใช้ แปลว่ามีสำเนาอยู่ในมือคนอื่น
        //  (คนที่ขโมยไป หรือคนที่เป็นเจ้าของ — เราแยกไม่ออก) ทางที่ปลอดภัยคือ
        //  ยกเลิกทุกใบของ user นั้นแล้วให้ login ใหม่
        //
        //  ถ้าไม่ทำ ผู้ที่ขโมย token ไปจะ refresh ต่อได้เรื่อย ๆ ไม่มีสิ้นสุด
        // ─────────────────────────────────────────────────────────────────
        if (stored.RevokedAt is not null)
        {
            await users.RevokeAllForUserAsync(
                stored.UserId,
                "ตรวจพบการใช้ refresh token ที่ถูก rotate แล้วซ้ำ — สงสัยว่า token รั่ว",
                ct);

            return Error.Unauthorized(
                "session ถูกยกเลิกด้วยเหตุผลด้านความปลอดภัย กรุณาเข้าสู่ระบบใหม่",
                "refresh_token_reused");
        }

        if (!stored.IsActive(DateTimeOffset.UtcNow))
        {
            return Error.Unauthorized("refresh token หมดอายุ", "refresh_token_expired");
        }

        var replacement = BuildRefreshToken(stored.UserId, client);
        await users.RotateRefreshTokenAsync(stored, replacement.Entity, ct);

        var memberships = await identity.ListMembershipsAsync(stored.UserId, ct);
        var access = tokens.CreateAccessToken(stored.User);

        return new AuthResponse(
            access.Token,
            access.ExpiresAt,
            replacement.Pair.Token,
            replacement.Pair.ExpiresAt,
            stored.User.ToDto(),
            memberships.Select(m => m.ToSummaryDto()).ToList());
    }

    public async Task<Result> LogoutAsync(string refreshToken, CancellationToken ct = default)
    {
        var hash = tokens.HashRefreshToken(refreshToken);
        var stored = await users.FindRefreshTokenWithUserAsync(hash, ct);

        // ตอบสำเร็จแม้ไม่พบ token — logout ควร idempotent และการบอกว่า "ไม่พบ"
        // ก็ไม่ช่วยอะไรผู้ใช้
        if (stored is not null && stored.RevokedAt is null)
        {
            await users.RevokeAllForUserAsync(stored.UserId, "ผู้ใช้ออกจากระบบ", ct);
        }

        return Result.Success();
    }

    public async Task<Result<AuthResponse>> GetCurrentAsync(
        Guid userId, CancellationToken ct = default)
    {
        var user = await identity.FindUserByIdAsync(userId, ct);
        if (user is null)
        {
            // token ยังไม่หมดอายุแต่ user ถูกลบไปแล้ว
            return Error.Unauthorized("ไม่พบผู้ใช้", "user_not_found");
        }

        var memberships = await identity.ListMembershipsAsync(userId, ct);

        // /me ไม่ออก token ใหม่ — ส่งค่าว่างในช่อง token
        return new AuthResponse(
            string.Empty,
            DateTimeOffset.MinValue,
            string.Empty,
            DateTimeOffset.MinValue,
            user.ToDto(),
            memberships.Select(m => m.ToSummaryDto()).ToList());
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  helpers
    // ═══════════════════════════════════════════════════════════════════════

    private async Task<AuthResponse> IssueTokensAsync(
        User user,
        ClientInfo client,
        IReadOnlyList<WorkspaceSummaryDto> workspaces,
        CancellationToken ct)
    {
        var access = tokens.CreateAccessToken(user);
        var refresh = BuildRefreshToken(user.Id, client);

        await users.AddRefreshTokenAsync(refresh.Entity, ct);

        return new AuthResponse(
            access.Token,
            access.ExpiresAt,
            refresh.Pair.Token,
            refresh.Pair.ExpiresAt,
            user.ToDto(),
            workspaces);
    }

    private (RefreshTokenPair Pair, RefreshToken Entity) BuildRefreshToken(
        Guid userId, ClientInfo client)
    {
        var pair = tokens.CreateRefreshToken();

        return (pair, new RefreshToken
        {
            UserId = userId,
            TokenHash = pair.TokenHash,
            ExpiresAt = pair.ExpiresAt,
            UserAgent = Truncate(client.UserAgent, 400),
            IpAddress = Truncate(client.IpAddress, 45)
        });
    }

    private static string NormalizeEmail(string email) => email.Trim();

    private static string? Truncate(string? value, int max)
        => value is null || value.Length <= max ? value : value[..max];

    private static Error InvalidCredentials =>
        Error.Unauthorized("อีเมลหรือรหัสผ่านไม่ถูกต้อง", "invalid_credentials");

    /// <summary>
    /// bcrypt hash ของสตริงคงที่ ใช้เพื่อให้เวลาตอบสนองของ login เท่ากันไม่ว่า
    /// อีเมลจะมีอยู่จริงหรือไม่ (ดูคอมเมนต์ใน LoginAsync)
    ///
    /// work factor ต้องเท่ากับที่ PasswordHasher ใช้ ไม่งั้นเวลาที่ใช้จะต่างกัน
    /// จนกลายเป็น timing signal อีกทาง
    /// </summary>
    private const string DummyHash =
        "$2a$12$C6UzMDM.H6dfI/f/IKcEe.rIfFCbHhCLDR1H8LqAcXKMK9pM7Gm3O";
}
