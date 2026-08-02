#:package YDotNet@0.6.0
#:package YDotNet.Native@0.6.0

// ═══════════════════════════════════════════════════════════════════════════
//  spike: YDotNet เขียน "mark" (ตัวหนา/ลิงก์) ที่ yjs 13.x อ่านออกได้จริงไหม
//
//      dotnet run scripts/spike-marks.cs | node scripts/spike-marks.mjs
//
//  ⚠️ นี่คือจุดยกเลิกของงานใส่ตัวหนา/เอียง/ลิงก์
//
//     API ฝั่ง C# มีครบ (XmlText.Format + Input.Object — reflect ดูแล้ว) และ
//     ฝั่ง JS พิสูจน์แล้วว่า mark ที่ถูกต้องผ่าน node.check() ได้ แต่ "สะพาน"
//     ระหว่างสองฝั่ง — ว่า ContentFormat ที่ yrs เขียนออกมา decode ได้ตรงกับที่
//     yjs 13.x คาดหวังหรือไม่ — ยังไม่มีใครพิสูจน์
//
//     ต้องรู้คำตอบก่อนเขียนโค้ดจริง เพราะความล้มเหลวแบบครึ่ง ๆ กลาง ๆ ของเรื่องนี้
//     คือ "ข้อความถูกลบเงียบ ๆ โดยที่ node.check() ยังผ่าน" (ทดลองยืนยันแล้ว)
//     ไม่ใช่แค่แสดงผลไม่สวย
//
//  ⚠️ offset เป็นหน่วย UTF-16 code unit — DocOptions.Encoding ปล่อยเป็นค่าเริ่มต้น
//     (Utf16) ซึ่งตรงกับทั้ง C# string.Length และ yjs ห้ามไปตั้งเป็น Utf8
// ═══════════════════════════════════════════════════════════════════════════

using YDotNet.Document;
using YDotNet.Document.Cells;
using YDotNet.Document.Options;

const string Plain = "ปกติ";
const string Bold = "หนา";
const string Linked = "ลิงก์";
const string Url = "https://example.test/ก";

var doc = new Doc(new DocOptions { Id = 4242 });
var fragment = doc.XmlFragment("blocknote");

byte[] before;
using (var read = doc.ReadTransaction()) before = read.StateVectorV1();

using (var write = doc.WriteTransaction(origin: null!))
{
    var group = fragment.InsertElement(write, 0, "blockGroup");
    var container = group.InsertElement(write, 0, "blockContainer");
    container.InsertAttribute(write, "id", Guid.CreateVersion7().ToString());

    var paragraph = container.InsertElement(write, 0, "paragraph");
    var text = paragraph.InsertText(write, 0);

    // ⚠️ Insert ครั้งเดียวแล้วค่อย Format เป็นช่วง ๆ
    //    Insert ที่ attributes เป็น null "สืบทอดรูปแบบจากตำแหน่งนั้น" ซึ่งทำให้
    //    ข้อความที่เขียนต่อจากช่วงตัวหนากลายเป็นตัวหนาไปด้วยโดยไม่ตั้งใจ
    text.Insert(write, 0, Plain + Bold + Linked, null!);

    using var bold = Input.Object(new Dictionary<string, Input>
    {
        // ค่าของ mark คือ "attrs object" ของมัน — ตัวที่ไม่มี attr ใช้ object ว่าง
        ["bold"] = Input.Object(new Dictionary<string, Input>()),
    });
    text.Format(write, (uint)Plain.Length, (uint)Bold.Length, bold);

    using var link = Input.Object(new Dictionary<string, Input>
    {
        ["link"] = Input.Object(new Dictionary<string, Input> { ["href"] = Input.String(Url) }),
    });
    text.Format(write, (uint)(Plain.Length + Bold.Length), (uint)Linked.Length, link);

    write.Commit();
}

using var diff = doc.ReadTransaction();
Console.WriteLine(Convert.ToBase64String(diff.StateDiffV1(before)));
