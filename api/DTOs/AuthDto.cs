namespace ProjectManagementAPI.DTOs;

// ═══════════════════════════════════════════════════════════════════════════
//  Auth — request / response ที่ boundary เท่านั้น
//  entity ห้ามข้ามเส้นนี้ (ดู Mapping/UserMapping.cs)
// ═══════════════════════════════════════════════════════════════════════════

public record RegisterRequest(string Email, string Password, string Name);

public record LoginRequest(string Email, string Password);

public record RefreshRequest(string RefreshToken);

public record AuthResponse(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt,
    UserDto User,
    IReadOnlyList<WorkspaceSummaryDto> Workspaces);

/// <param name="Kind">"human" หรือ "agent" — ใช้แยกงานที่ AI ทำออกจากงานที่คนทำ</param>
public record UserDto(
    Guid Id,
    string Email,
    string Name,
    string? AvatarUrl,
    string Locale,
    string Kind);

public record WorkspaceSummaryDto(
    Guid Id,
    string Slug,
    string Name,
    string? Icon,
    string Role);
