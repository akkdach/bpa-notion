using Microsoft.AspNetCore.Mvc;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Controllers;

// ═══════════════════════════════════════════════════════════════════════════
//  Health check
//
//  สังเกตว่า controller นี้ไม่มี AppDbContext เลย มีแต่ IHealthRepository
//  นี่คือรูปแบบที่ controller ทุกตัวในโปรเจกต์นี้ต้องเป็น และมี CI gate
//  คอยเช็คว่าไม่มีใครเผลอ inject DbContext เข้ามา
// ═══════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/v1/health")]
public class HealthCheckController(IHealthRepository healthRepository) : ControllerBase
{
    /// <summary>
    /// liveness + readiness รวมกัน: ตอบ 200 เมื่อ API ตอบได้ ต่อฐานข้อมูลได้
    /// และ extension ที่จำเป็นครบ ตอบ 503 เมื่อข้อใดข้อหนึ่งไม่ผ่าน
    /// </summary>
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var db = await healthRepository.CheckDatabaseAsync(cancellationToken);

        var payload = new
        {
            status = db.IsHealthy ? "healthy" : "unhealthy",
            timestamp = DateTime.UtcNow,
            database = new
            {
                canConnect = db.CanConnect,
                latencyMs = db.LatencyMs,
                serverVersion = db.ServerVersion,
                extensions = db.Extensions,
                missingExtensions = db.MissingExtensions,
                error = db.Error
            }
        };

        if (!db.IsHealthy)
        {
            // 503 ทำให้ docker healthcheck และ load balancer เห็นว่า instance
            // นี้ยังไม่พร้อมรับ traffic — ตอบ 200 พร้อม status:"unhealthy"
            // จะไม่มีใครสังเกตเลย
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                ApiResponse<object>.Fail(
                    db.Error ?? $"extension ที่ขาด: {string.Join(", ", db.MissingExtensions)}",
                    code: "unhealthy") with { Data = payload });
        }

        return Ok(ApiResponse<object>.Ok(payload));
    }
}
