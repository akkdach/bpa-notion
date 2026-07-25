using ProjectManagementAPI.Data;
using ProjectManagementAPI.Domain;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Mapping;

// ═══════════════════════════════════════════════════════════════════════════
//  entity → DTO แบบเขียนมือ
//
//  ⚠️ ไม่ใช้ AutoMapper โดยเจตนา (มี CI gate บังคับ)
//
//  ในแอป multi-tenant การ map แบบอัตโนมัติคือเครื่องผลิต data leak: มันจะ
//  คัดลอก PasswordHash และ WorkspaceId ออกไปกับ response โดยไม่มีใครสังเกต
//  และเมื่อผิดก็ผิดตอน runtime ไม่ใช่ตอน compile
//
//  โค้ดข้างล่างนี้น่าเบื่อ ซึ่งเป็นข้อดี: field ที่จะออกไปข้างนอกถูกพิมพ์ชื่อ
//  ไว้ทุกตัว การเพิ่ม field ใหม่ใน entity ไม่ทำให้มันหลุดออกไปเอง
// ═══════════════════════════════════════════════════════════════════════════
public static class UserMapping
{
    public static UserDto ToDto(this User user) => new(
        user.Id,
        user.Email,
        user.Name,
        user.AvatarUrl,
        user.Locale);
}

public static class WorkspaceMapping
{
    public static WorkspaceSummaryDto ToSummaryDto(this WorkspaceMembershipRow row) => new(
        row.WorkspaceId,
        row.Slug,
        row.Name,
        row.Icon,
        row.Role.ToDbValue());

    public static WorkspaceSummaryDto ToSummaryDto(this Workspace workspace, WorkspaceRole role) => new(
        workspace.Id,
        workspace.Slug,
        workspace.Name,
        workspace.Icon,
        role.ToDbValue());
}
