using ProjectManagementAPI.Domain;

namespace ProjectManagementAPI.Data;

// ═══════════════════════════════════════════════════════════════════════════
//  ITenantContext — workspace ที่ request นี้ทำงานอยู่
//
//  AppDbContext อ่านค่านี้ผ่าน global query filter ทุก query จึงถูกจำกัดขอบเขต
//  โดยอัตโนมัติ
//
//  ── ต่างจาก PLAN.md ตรงนี้ (โดยเจตนา) ──────────────────────────────────────
//  แผนเดิมให้ JWT ถือ claim workspace_id แต่ implementation นี้ให้ workspace
//  มาจาก header X-Workspace-Id แล้ว "ตรวจสมาชิกภาพทุก request" เหตุผล:
//
//    1. ถ้า workspace ฝังใน JWT อายุ 24 ชม. การถอด user ออกจาก workspace
//       จะไม่มีผลจนกว่า token หมดอายุ — นั่นคือช่องว่างด้านสิทธิ์ 24 ชั่วโมง
//    2. สลับ workspace ไม่ต้องออก token ใหม่
//    3. SignalR ก็ไม่ต้องพึ่ง claim — JoinDocument หา workspace จาก "หน้า"
//       ที่ขอเข้า แล้วตรวจสมาชิกภาพเอง ซึ่งปลอดภัยกว่าเชื่อค่าที่ client ส่ง
//
//  ราคาที่จ่ายคือ query ตรวจสมาชิกภาพ 1 ครั้งต่อ request ซึ่ง cache ได้
// ═══════════════════════════════════════════════════════════════════════════
public interface ITenantContext
{
    /// <summary>workspace ปัจจุบัน — null เมื่อ request ไม่ผูกกับ workspace (login, /me)</summary>
    Guid? WorkspaceId { get; }

    /// <summary>user ที่ login — null เมื่อยังไม่ได้ login</summary>
    Guid? UserId { get; }

    /// <summary>สิทธิ์ของ user ใน workspace ปัจจุบัน</summary>
    WorkspaceRole? WorkspaceRole { get; }

    bool HasWorkspace => WorkspaceId is not null;

    /// <summary>อ่าน WorkspaceId แบบยืนยันว่าต้องมี — ใช้ใน service ที่ต้องมี tenant แน่ ๆ</summary>
    Guid RequireWorkspaceId();

    Guid RequireUserId();
}

public interface ITenantContextSetter
{
    void SetUser(Guid userId);
    void SetWorkspace(Guid workspaceId, WorkspaceRole role);
}
