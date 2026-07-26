using System.Text.Json;
using ProjectManagementAPI.Domain;

namespace ProjectManagementAPI.Models;

// ═══════════════════════════════════════════════════════════════════════════
//  Page — แถวใน database ก็เป็น page (kind = db_row)
//
//  เนื้อหาของหน้าอยู่ใน Yjs blob (page_doc_updates / page_doc_snapshots)
//  ตารางนี้เก็บเฉพาะ metadata + projection ที่ client ส่งกลับมา (title)
//  ดู PLAN.md "Yjs เป็น source of truth สำหรับเนื้อหา"
// ═══════════════════════════════════════════════════════════════════════════
public class Page
{
    public Guid Id { get; set; }
    public Guid WorkspaceId { get; set; }

    public Guid? ParentId { get; set; }

    /// <summary>
    /// root..parent เรียงจากบนลงล่าง มี GIN index
    ///
    /// เป็น read optimization — ParentId คือความจริง (มี FK บังคับ)
    /// ย้าย subtree 500 หน้า = UPDATE เดียวด้วย `ancestor_ids @> ARRAY[id]`
    /// สร้างใหม่จาก ParentId ได้ด้วย recursive CTE ถ้าเพี้ยน
    /// </summary>
    public Guid[] AncestorIds { get; set; } = [];

    public int Depth { get; set; }

    /// <summary>
    /// fractional index — แทรกระหว่างเพื่อนบ้าน = เขียนแถวเดียว ไม่ต้อง renumber
    ///
    /// ⚠️ ranks ชนกันได้ตามปกติ (สอง client แทรกที่เดียวกันพร้อมกัน)
    ///    ห้ามทำ unique index บน (parent_id, rank) และต้อง ORDER BY rank, id เสมอ
    /// </summary>
    public string Rank { get; set; } = string.Empty;

    public PageKind Kind { get; set; } = PageKind.Page;

    /// <summary>ไม่ null เมื่อ Kind = DbRow</summary>
    public Guid? DatabaseId { get; set; }

    /// <summary>projection จาก Yjs — client ส่งมาหลังหยุดพิมพ์ 2 วินาที</summary>
    public string Title { get; set; } = string.Empty;

    public string? Icon { get; set; }
    public string? CoverUrl { get; set; }

    /// <summary>
    /// สถานะงานอย่างง่าย: todo / doing / done — null = หน้านี้ไม่ใช่ "งาน"
    ///
    /// เป็นคอลัมน์ชั้นหนึ่งแยกจาก Properties (ซึ่งเป็น property ของ db_row ใน Phase 4)
    /// เพื่อให้ query/filter/sort งานได้ตรง ๆ โดยไม่ต้องแกะ jsonb
    /// ใช้โดย MCP (Claude Code) เป็นหลัก — ดู mcp/ ใน repo
    /// </summary>
    public string? Status { get; set; }

    /// <summary>ค่า property ของแถว database (Phase 4) — key เป็น property UUID</summary>
    public JsonDocument? Properties { get; set; }

    /// <summary>ผล formula / rollup ที่ materialise ไว้ให้ filter และ sort ได้ (Phase 4c)</summary>
    public JsonDocument? Computed { get; set; }

    /// <summary>
    /// ancestor-or-self ที่ใกล้สุดซึ่งมี page_acl ของตัวเอง
    ///
    /// ทำให้ resolve สิทธิ์ได้ด้วย query เดียวที่ความลึกคงที่ ไม่ต้องไล่ขึ้น tree
    /// ⚠️ ค่านี้เพี้ยน = บั๊กเรื่องสิทธิ์ ซึ่งเป็นบั๊กที่แย่ที่สุด — มี
    ///    RecomputeAccessRoots ไว้ซ่อม และควรรันเป็น consistency check รายวัน
    /// </summary>
    public Guid AccessRootId { get; set; }

    public DateTimeOffset? ArchivedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }

    public Guid? CreatedBy { get; set; }
    public Guid? LastEditedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Page? Parent { get; set; }
    public ICollection<Page> Children { get; set; } = [];
}
