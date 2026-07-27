namespace ProjectManagementAPI.Domain;

// ═══════════════════════════════════════════════════════════════════════════
//  ชนิดของเหตุการณ์ใน activity_log
//
//  เป็น const string ไม่ใช่ enum เพราะ log เป็นข้อมูล "ประวัติศาสตร์" — แถวที่
//  เขียนไปแล้วต้องอ่านได้ตลอดไป แม้โค้ดรุ่นใหม่จะเลิกผลิต action ชนิดนั้นแล้ว
//  enum + ValueConverter จะ throw ตอนอ่านค่าที่ไม่รู้จัก (ดู RoleConverters) ซึ่ง
//  ถูกต้องสำหรับ role แต่ผิดสำหรับ log: การอ่านประวัติเก่าไม่ควรพังเพราะเราเลิกใช้
//  action หนึ่งไป
//
//  ⚠️ ไม่มี CHECK constraint บนคอลัมน์นี้โดยเจตนา ต่างจาก enum อื่นในระบบ
//     ด้วยเหตุผลเดียวกัน — constraint จะทำให้ลบ action เก่าออกจากโค้ดไม่ได้เลย
// ═══════════════════════════════════════════════════════════════════════════
public static class ActivityAction
{
    public const string PageCreated = "page_created";
    public const string PageRenamed = "page_renamed";
    public const string StatusChanged = "status_changed";
    public const string IconChanged = "icon_changed";
    public const string PageMoved = "page_moved";
    public const string PageDeleted = "page_deleted";
    public const string PageRestored = "page_restored";
    public const string NoteAdded = "note_added";
}
