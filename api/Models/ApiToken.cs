namespace ProjectManagementAPI.Models;

// ═══════════════════════════════════════════════════════════════════════════
//  ApiToken — กุญแจให้เครื่องภายนอก (MCP server) เข้าถึง workspace หนึ่ง
//
//  แทนที่การให้ MCP เก็บ "อีเมล + รหัสผ่าน" ของบัญชี AI ไว้บนดิสก์แล้ว login เอง
//  ซึ่งมีปัญหาสี่ข้อที่ token แก้ได้หมด:
//
//    · รหัสผ่านคือกุญแจดอกเดียวกับที่คนใช้เข้าเว็บ — ไม่มี scope ไม่มีวันหมดอายุ
//    · เพิกถอนเฉพาะเครื่องไม่ได้ ต้องถอดทั้งบัญชีออกจาก workspace
//    · หลายเครื่องต้องคัดลอกรหัสผ่านส่งต่อกัน
//    · ไม่รู้ว่ามีเครื่องไหนเชื่อมอยู่บ้าง และใช้ครั้งสุดท้ายเมื่อไหร่
//
//  ⚠️ เก็บเฉพาะ hash — ค่าจริงแสดงครั้งเดียวตอนสร้างแล้วไม่มีทางอ่านคืนได้อีก
//     ถ้าลูกค้าทำหาย ต้องสร้างใบใหม่แล้วเพิกถอนใบเก่า ไม่ใช่ "ขอดูอีกที"
// ═══════════════════════════════════════════════════════════════════════════
public class ApiToken
{
    public Guid Id { get; set; }

    /// <summary>
    /// workspace ที่ token นี้ใช้ได้ — ผูกไว้กับใบ ไม่ได้มาจาก header
    /// </summary>
    /// <remarks>
    /// ⚠️ เป็นหัวใจของการจำกัดขอบเขต: บัญชี AI อาจเป็นสมาชิกหลาย workspace แต่
    ///    token หนึ่งใบใช้ได้กับ workspace เดียว การใช้ใบของ workspace A ไปเรียก
    ///    workspace B ต้องถูกปฏิเสธ ไม่ใช่ปล่อยผ่านเพราะบัญชีบังเอิญเป็นสมาชิกทั้งคู่
    /// </remarks>
    public Guid WorkspaceId { get; set; }

    /// <summary>
    /// บัญชีที่ token นี้ทำงานแทน — ปกติคือบัญชี agent ของ workspace นั้น
    ///
    /// ทุกอย่างที่ทำผ่าน token จะถูกบันทึกว่าบัญชีนี้เป็นคนทำ (activity_log,
    /// last_edited_by) ซึ่งเป็นเหตุผลที่ยังต้องมีบัญชี ไม่ใช่ token ลอย ๆ
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>ชื่อที่คนตั้งเอง เช่น "โน้ตบุ๊กสมชาย" — ไว้ให้รู้ว่าจะเพิกถอนใบไหน</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>SHA-256 hex ของค่าจริง — ดู ITokenService.HashRefreshToken สำหรับเหตุผลที่ไม่ใช้ bcrypt</summary>
    public string TokenHash { get; set; } = string.Empty;

    /// <summary>
    /// สี่ตัวท้ายของค่าจริง — ใช้แสดงในรายการให้คนจำใบได้ ("…7f3a")
    /// ไม่ใช่ความลับ เดาส่วนที่เหลืออีก 252 บิตจากนี้ไม่ได้
    /// </summary>
    public string Last4 { get; set; } = string.Empty;

    /// <summary>ใครเป็นคนสร้าง (owner/admin) — คนละคนกับ UserId ที่ token ทำงานแทน</summary>
    public Guid? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>null = ไม่มีวันหมดอายุ</summary>
    public DateTimeOffset? ExpiresAt { get; set; }

    /// <summary>
    /// ใช้ครั้งสุดท้ายเมื่อไหร่ — อัปเดตแบบหน่วง ไม่ใช่ทุก request
    /// (ดู ApiTokenRepository.TouchAsync — เขียนทุก request คือเขียนต่อทุกการอ่าน)
    /// </summary>
    public DateTimeOffset? LastUsedAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }

    public User? User { get; set; }

    /// <summary>ใช้ได้อยู่ไหม ณ เวลาที่ให้มา</summary>
    public bool IsActive(DateTimeOffset now)
        => RevokedAt is null && (ExpiresAt is null || ExpiresAt > now);
}
