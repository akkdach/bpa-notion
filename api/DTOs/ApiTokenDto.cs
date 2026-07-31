namespace ProjectManagementAPI.DTOs;

// ═══════════════════════════════════════════════════════════════════════════
//  API token — กุญแจให้เครื่องภายนอก (MCP) เข้าถึง workspace
// ═══════════════════════════════════════════════════════════════════════════

/// <param name="Name">ชื่อที่คนตั้งเอง เช่น "โน้ตบุ๊กสมชาย" — ไว้ให้รู้ว่าจะเพิกถอนใบไหน</param>
/// <param name="ExpiresInDays">null = ไม่มีวันหมดอายุ</param>
public record CreateApiTokenRequest(string Name, int? ExpiresInDays);

/// <param name="Token">
/// ค่าจริง — **แสดงครั้งเดียวเท่านั้น** ฐานข้อมูลเก็บแค่ hash จึงอ่านคืนไม่ได้อีก
/// </param>
public record CreatedApiTokenDto(
    Guid Id,
    string Name,
    string Token,
    string Last4,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ExpiresAt);

/// <param name="Last4">สี่ตัวท้ายของค่าจริง — ไว้ให้คนจำใบได้ ไม่ใช่ความลับ</param>
/// <param name="Status">active / revoked / expired</param>
public record ApiTokenDto(
    Guid Id,
    string Name,
    string Last4,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? LastUsedAt);
