namespace ProjectManagementAPI.DTOs;

// ═══════════════════════════════════════════════════════════════════════════
//  Search
// ═══════════════════════════════════════════════════════════════════════════

/// <param name="Snippet">
/// ท่อนข้อความรอบคำที่เจอ คำที่ตรงถูกครอบด้วย &lt;span class="keyword"&gt;
/// (รูปแบบของ pgroonga_snippet_html) — ว่างได้เมื่อคำไปตรงที่ชื่อหน้าเท่านั้น
///
/// ⚠️ เป็น HTML ที่ PGroonga escape เนื้อหาให้แล้ว แต่ฝั่งที่แสดงต้องยังตั้งใจ
///    ว่าจะ render เป็น HTML หรือถอด tag ออก — อย่าเอาไปต่อสตริงกับ HTML อื่น
///    โดยไม่คิด
/// </param>
/// <param name="Score">คะแนนความตรงจาก PGroonga — เทียบกันได้เฉพาะภายในผลค้นชุดเดียว</param>
public record SearchHitDto(
    Guid Id,
    Guid? ParentId,
    string Title,
    string? Icon,
    string? Status,
    string Snippet,
    double Score,
    DateTimeOffset UpdatedAt);

/// <param name="Truncated">
/// true = ผลลัพธ์ถูกตัดที่ limit อาจมีมากกว่านี้
///
/// บอกไปตรง ๆ เพราะการตัดผลลัพธ์เงียบ ๆ ทำให้ผู้เรียก (โดยเฉพาะ AI) สรุปว่า
/// "ค้นแล้วเจอเท่านี้" ทั้งที่ยังมีอีก
/// </param>
public record SearchResultDto(
    string Query,
    int Count,
    bool Truncated,
    IReadOnlyList<SearchHitDto> Hits);
