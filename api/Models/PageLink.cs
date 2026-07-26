namespace ProjectManagementAPI.Models;

/// <summary>
/// ลิงก์จากหน้าหนึ่งไปอีกหน้าหนึ่ง (`@page` mention ในเนื้อหา)
///
/// เป็นข้อมูล derived เหมือน <see cref="PageSearch"/> — client แกะรายการลิงก์
/// ออกจาก Yjs document แล้วส่งมากับ projection เพราะเซิร์ฟเวอร์อ่าน Yjs ไม่ได้
/// ถ้าล้าสมัย แผง backlinks จะล้าสมัย แต่สร้างใหม่ได้เสมอจากเอกสารจริง
///
/// ทางอ่านที่สำคัญคือ "ย้อนกลับ": หน้านี้ถูกอ้างถึงจากที่ไหนบ้าง
/// จึงมี index บน (workspace_id, target_page_id) ไม่ใช่แค่ฝั่ง source
/// </summary>
public class PageLink
{
    public Guid WorkspaceId { get; set; }

    /// <summary>หน้าที่มีลิงก์อยู่ในเนื้อหา</summary>
    public Guid SourcePageId { get; set; }

    /// <summary>หน้าที่ถูกลิงก์ถึง</summary>
    public Guid TargetPageId { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
