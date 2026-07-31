namespace ProjectManagementAPI.DTOs;

// ═══════════════════════════════════════════════════════════════════════════
//  Workspace
//  (WorkspaceSummaryDto อยู่ใน AuthDto.cs เพราะ /auth/me และ login คืนมันด้วย)
// ═══════════════════════════════════════════════════════════════════════════

public record CreateWorkspaceRequest(string Name, string? Slug, string? Icon);

public record UpdateWorkspaceRequest(string Name, string? Icon);

/// <summary>เพิ่มสมาชิกด้วยอีเมลของ user ที่สมัครไว้แล้ว — ไม่มีการเชิญทางอีเมล</summary>
public record AddMemberRequest(string Email, string Role);

/// <param name="Role">owner / admin / member / guest</param>
/// <param name="Kind">
/// "human" หรือ "agent" — null = ไม่แตะ
///
/// อยู่ที่ endpoint นี้เพราะ "บัญชีนี้คือบอท" เป็นสิ่งที่ owner/admin ยืนยัน ไม่ใช่
/// สิ่งที่บัญชีประกาศเกี่ยวกับตัวเองตอนสมัคร — ถ้าใครตั้งเองได้ ก็ปลอมให้การแก้ของ
/// ตัวเองดูเหมือน AI ทำ (หรือกลับกัน) ได้ ซึ่งทำลายจุดประสงค์ของคอลัมน์นี้ทั้งหมด
///
/// ⚠️ ขอบเขตไม่ตรงกันเล็กน้อยโดยรู้ตัว: users.kind เป็นค่าระดับ "ทั้งระบบ" แต่ตั้ง
///    ผ่าน endpoint ระดับ workspace ยอมรับได้เพราะบัญชี agent หนึ่งบัญชีผูกกับ
///    workspace เดียว (ApiTokenService.EnsureAgentAsync ตั้งอีเมลจาก slug) และ
///    endpoint นี้ตรวจ owner/admin + สมาชิกภาพให้แล้ว ถ้าวันหนึ่งบัญชีเดียวถูกใช้
///    หลาย workspace ต้องย้ายไปอยู่ใต้ /users
/// </param>
public record UpdateMemberRoleRequest(string Role, string? Kind = null);

public record WorkspaceDetailDto(
    Guid Id,
    string Slug,
    string Name,
    string? Icon,
    string MyRole,
    int MemberCount,
    DateTimeOffset CreatedAt);

/// <param name="Kind">"human" หรือ "agent" — ให้หน้าสมาชิกบอกได้ว่าอันไหนคือบัญชีของ AI</param>
public record MemberDto(
    Guid UserId,
    string Email,
    string Name,
    string? AvatarUrl,
    string Role,
    string Kind,
    DateTimeOffset JoinedAt);
