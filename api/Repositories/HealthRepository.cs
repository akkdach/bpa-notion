using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Repositories;

// ═══════════════════════════════════════════════════════════════════════════
//  HealthRepository
//
//  ไฟล์ใน Repositories/ คือที่เดียวที่ AppDbContext ปรากฏได้ (CI บังคับ)
// ═══════════════════════════════════════════════════════════════════════════
public class HealthRepository(
    AppDbContext db,
    ILogger<HealthRepository> logger) : IHealthRepository
{
    public async Task<DatabaseHealth> CheckDatabaseAsync(
        CancellationToken cancellationToken = default)
    {
        var stopwatch = Stopwatch.StartNew();

        try
        {
            await using var connection = new NpgsqlConnection(db.Database.GetConnectionString());
            await connection.OpenAsync(cancellationToken);

            // query จริง ไม่ใช่แค่ CanConnectAsync() — เอา version กับรายการ
            // extension มาด้วยเลย เพื่อให้ health check จับกรณีที่ต่อฐานได้
            // แต่ pgroonga ไม่ได้ติดตั้ง (เช่นตอนมีคนสลับ image กลับไปเป็น
            // postgres:18 ธรรมดา) ซึ่งเป็นความพังที่เงียบที่สุด
            await using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT current_setting('server_version'),
                       COALESCE(
                           (SELECT array_agg(extname::text ORDER BY extname::text)
                              FROM pg_extension
                             WHERE extname::text = ANY(@required)),
                           '{}'::text[]
                       )
                """;
            command.Parameters.AddWithValue("required", DatabaseHealth.RequiredExtensions);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            if (!await reader.ReadAsync(cancellationToken))
            {
                stopwatch.Stop();
                return new DatabaseHealth(false, stopwatch.ElapsedMilliseconds, null, [],
                    "query ไม่คืนแถวใด ๆ");
            }

            var version = reader.GetString(0);
            var extensions = reader.GetFieldValue<string[]>(1);

            stopwatch.Stop();

            return new DatabaseHealth(
                CanConnect: true,
                LatencyMs: stopwatch.ElapsedMilliseconds,
                ServerVersion: version,
                Extensions: extensions,
                Error: null);
        }
        catch (Exception ex) when (ex is NpgsqlException or TimeoutException or InvalidOperationException)
        {
            stopwatch.Stop();

            logger.LogWarning(ex, "Database health check failed after {Elapsed}ms",
                stopwatch.ElapsedMilliseconds);

            return new DatabaseHealth(
                CanConnect: false,
                LatencyMs: stopwatch.ElapsedMilliseconds,
                ServerVersion: null,
                Extensions: [],
                Error: ex.Message);
        }
    }
}
