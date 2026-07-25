namespace ProjectManagementAPI.Repositories.Abstractions;

/// <summary>
/// การเข้าถึงฐานข้อมูลสำหรับ health check
///
/// มี interface ให้ health check ก็เพราะกฎเดียวกับทุกที่: controller แตะ
/// AppDbContext ไม่ได้ ต้องผ่าน repository เสมอ — ไม่มีข้อยกเว้นให้ endpoint
/// ที่ "ง่าย ๆ" เพราะข้อยกเว้นข้อแรกคือจุดที่มาตรฐานเริ่มพัง
/// </summary>
public interface IHealthRepository
{
    /// <summary>ping ฐานข้อมูลจริง — ไม่ใช่แค่เช็คว่า connection string มีค่า</summary>
    Task<DatabaseHealth> CheckDatabaseAsync(CancellationToken cancellationToken = default);
}

/// <param name="CanConnect">เชื่อมต่อได้หรือไม่</param>
/// <param name="LatencyMs">เวลา round-trip ของ query จริง</param>
/// <param name="ServerVersion">version ของ Postgres ที่ต่ออยู่</param>
/// <param name="Extensions">extension ที่ติดตั้งแล้ว — ต้องมี pgroonga</param>
/// <param name="Error">ข้อความ error ถ้าต่อไม่ได้</param>
public record DatabaseHealth(
    bool CanConnect,
    long LatencyMs,
    string? ServerVersion,
    IReadOnlyList<string> Extensions,
    string? Error)
{
    /// <summary>extension ที่ระบบต้องมี ไม่มีแล้วทำงานไม่ได้</summary>
    public static readonly string[] RequiredExtensions = ["pgroonga", "pgcrypto", "citext"];

    public IReadOnlyList<string> MissingExtensions =>
        [.. RequiredExtensions.Except(Extensions, StringComparer.OrdinalIgnoreCase)];

    public bool IsHealthy => CanConnect && MissingExtensions.Count == 0;
}
