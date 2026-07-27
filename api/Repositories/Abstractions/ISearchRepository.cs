namespace ProjectManagementAPI.Repositories.Abstractions;

public interface ISearchRepository
{
    /// <summary>
    /// ค้นหาข้อความไทยด้วย PGroonga จำกัดเฉพาะหน้าที่ผู้เรียกมีสิทธิ์เห็น
    /// </summary>
    /// <param name="query">คำค้นดิบจากผู้ใช้ — repository เป็นคน escape เอง</param>
    /// <param name="visibleAccessRoots">
    /// access root ที่ผู้ใช้เห็นได้ — ว่าง = ไม่เห็นอะไรเลย ผู้เรียกไม่ควรเรียกถึงที่นี่
    /// </param>
    /// <param name="statuses">กรองสถานะงาน — ว่าง = ไม่กรอง</param>
    /// <param name="limit">จำนวนผลลัพธ์สูงสุด</param>
    Task<List<SearchHit>> SearchAsync(
        string query,
        IReadOnlyList<Guid> visibleAccessRoots,
        IReadOnlyList<string> statuses,
        int limit,
        CancellationToken ct = default);
}

/// <param name="Score">คะแนนจาก pgroonga_score — สูงกว่า = ตรงกว่า</param>
/// <param name="Snippet">
/// ท่อนข้อความรอบคำที่เจอ พร้อมตัวคั่นที่ผู้เรียกเอาไปเน้นเองได้
/// ว่างได้เมื่อคำไปเจอใน title เท่านั้น ไม่ได้เจอในเนื้อหา
/// </param>
public record SearchHit(
    Guid Id,
    Guid? ParentId,
    string Title,
    string? Icon,
    string? Status,
    string Snippet,
    double Score,
    DateTimeOffset UpdatedAt);
