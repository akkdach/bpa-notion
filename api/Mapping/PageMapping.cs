using ProjectManagementAPI.Domain;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Models;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Mapping;

// ═══════════════════════════════════════════════════════════════════════════
//  entity → DTO แบบเขียนมือ (ไม่ใช้ AutoMapper — ดู UserMapping.cs)
//
//  สังเกตว่า WorkspaceId ไม่ได้ออกไปกับ DTO เลย client ไม่จำเป็นต้องรู้
//  และการที่ต้องพิมพ์ชื่อ field ทุกตัวเองคือสิ่งที่กันไม่ให้มันหลุดออกไป
// ═══════════════════════════════════════════════════════════════════════════
public static class PageMapping
{
    public static PageDto ToDto(this Page page, PageRole myRole) => new(
        page.Id,
        page.ParentId,
        page.AncestorIds,
        page.Depth,
        page.Rank,
        page.Kind.ToDbValue(),
        page.Title,
        page.Icon,
        page.CoverUrl,
        page.Status,
        page.AccessRootId,
        myRole.ToDbValue(),
        page.LastEditedBy,
        page.CreatedAt,
        page.UpdatedAt,
        page.DeletedAt);

    public static PageNodeDto ToNodeDto(this PageNode node) => new(
        node.Id,
        node.ParentId,
        node.Title,
        node.Icon,
        node.Status,
        node.Rank,
        node.Depth,
        node.HasChildren,
        node.LastEditedBy,
        node.UpdatedAt,
        node.DeletedAt);
}
