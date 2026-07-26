namespace ProjectManagementMcp;

// ═══════════════════════════════════════════════════════════════════════════
//  DTO สำหรับ deserialize response ของ API (camelCase, case-insensitive)
//  ตรงกับ api/Helpers/ApiResponse.cs และ api/DTOs/*
// ═══════════════════════════════════════════════════════════════════════════

public sealed record Envelope<T>(bool Success, T? Data, string? Message, string? Code);

public sealed record AuthResponse(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    IReadOnlyList<WorkspaceSummary> Workspaces);

public sealed record WorkspaceSummary(Guid Id, string Slug, string Name, string? Icon, string Role);

/// <summary>โหนดใน tree (sidebar) — ผลของ GET /api/v1/pages</summary>
public sealed record PageNode(
    Guid Id,
    Guid? ParentId,
    string Title,
    string? Icon,
    string? Status,
    string Rank,
    int Depth,
    bool HasChildren,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? DeletedAt);

/// <summary>หน้าเดี่ยว — ผลของ GET/POST/PATCH /api/v1/pages/{id}</summary>
public sealed record PageDto(
    Guid Id,
    Guid? ParentId,
    string Title,
    string? Icon,
    string? CoverUrl,
    string? Status,
    string Kind,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
