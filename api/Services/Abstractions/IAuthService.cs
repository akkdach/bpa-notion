using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;

namespace ProjectManagementAPI.Services.Abstractions;

public interface IAuthService
{
    Task<Result<AuthResponse>> RegisterAsync(
        RegisterRequest request, ClientInfo client, CancellationToken ct = default);

    Task<Result<AuthResponse>> LoginAsync(
        LoginRequest request, ClientInfo client, CancellationToken ct = default);

    Task<Result<AuthResponse>> RefreshAsync(
        string refreshToken, ClientInfo client, CancellationToken ct = default);

    Task<Result> LogoutAsync(string refreshToken, CancellationToken ct = default);

    Task<Result<AuthResponse>> GetCurrentAsync(Guid userId, CancellationToken ct = default);
}

/// <summary>ข้อมูลผู้เรียกที่เก็บติดกับ refresh token — ใช้สืบตอน token รั่ว</summary>
public record ClientInfo(string? UserAgent, string? IpAddress);
