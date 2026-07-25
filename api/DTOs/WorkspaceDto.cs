namespace ProjectManagementAPI.DTOs;

// ═══════════════════════════════════════════════════════════════════════════
//  Workspace
//  (WorkspaceSummaryDto อยู่ใน AuthDto.cs เพราะ /auth/me และ login คืนมันด้วย)
// ═══════════════════════════════════════════════════════════════════════════

public record CreateWorkspaceRequest(string Name, string? Slug, string? Icon);

public record UpdateWorkspaceRequest(string Name, string? Icon);

/// <summary>เพิ่มสมาชิกด้วยอีเมลของ user ที่สมัครไว้แล้ว — ไม่มีการเชิญทางอีเมล</summary>
public record AddMemberRequest(string Email, string Role);

public record UpdateMemberRoleRequest(string Role);

public record WorkspaceDetailDto(
    Guid Id,
    string Slug,
    string Name,
    string? Icon,
    string MyRole,
    int MemberCount,
    DateTimeOffset CreatedAt);

public record MemberDto(
    Guid UserId,
    string Email,
    string Name,
    string? AvatarUrl,
    string Role,
    DateTimeOffset JoinedAt);
