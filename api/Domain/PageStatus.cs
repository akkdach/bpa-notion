namespace ProjectManagementAPI.Domain;

// ═══════════════════════════════════════════════════════════════════════════
//  สถานะงาน — แหล่งความจริงเดียวของค่าที่ `pages.status` รับได้
//
//  เป็น const string ไม่ใช่ enum เพราะ null คือค่าที่มีความหมาย ("หน้านี้ไม่ใช่งาน")
//  และ `enum?` ทำให้ต้องแปลงไปกลับทุกชั้นโดยไม่ได้อะไรเพิ่ม — ต่างจาก PageRole
//  ที่มีลำดับความสำคัญให้เทียบ (ดู RoleExtensions.CanEdit)
//
//  ⚠️ ชื่อคลาสเป็น PageStatus ไม่ใช่ TaskStatus โดยเจตนา — ImplicitUsings เปิดอยู่
//     จึงมี System.Threading.Tasks.TaskStatus อยู่ใน scope ทุกไฟล์ ชื่อซ้ำจะกลายเป็น
//     ambiguous reference ในทุกไฟล์ที่ using Domain ด้วย
//
//  ⚠️ ค่าพวกนี้ต้องตรงกับ ck_pages_status ใน Migrations/Sql/001_check_constraints.sql
//     ที่เดียวที่ validate คือ PageTreeService.UpdateAsync — ฝั่ง mcp/ ไม่มีสำเนา
//     ของรายการนี้โดยเจตนา มันปล่อยให้ 400 จาก API เด้งกลับไปให้ AI อ่านเอง
//     (สำเนาที่ต้อง sync ด้วยมือคือสำเนาที่จะหลุด sync)
// ═══════════════════════════════════════════════════════════════════════════
public static class PageStatus
{
    public const string Todo = "todo";
    public const string Doing = "doing";
    public const string Done = "done";

    /// <summary>เรียงตามลำดับการทำงาน ไม่ใช่ตามตัวอักษร — ใช้ในข้อความบอก error ด้วย</summary>
    public static readonly IReadOnlyList<string> All = [Todo, Doing, Done];

    /// <summary>ค่าที่ normalise แล้วใช้ได้ไหม — ไม่ trim/lower ให้ ผู้เรียกต้องทำมาก่อน</summary>
    public static bool IsValid(string status) => All.Contains(status);

    /// <summary>รูปแบบที่ใช้ในข้อความบอก error</summary>
    public static string Listed => string.Join(", ", All);
}
