using Microsoft.EntityFrameworkCore;
using Npgsql;
using ProjectManagementAPI.Data;

namespace ProjectManagementAPI.Configurations;

// ═══════════════════════════════════════════════════════════════════════════
//  EF Core + PostgreSQL
//
//  connection string มาจากไหน (ลำดับความสำคัญของ .NET configuration
//  จากน้อยไปมาก — ตัวหลังทับตัวหน้า):
//
//    1. appsettings.json                  ว่างเสมอ — เป็นแค่การประกาศ key
//    2. appsettings.Development.json      host/port/database ของ dev (ไม่มี password)
//    3. User Secrets (dev เท่านั้น)        Postgres:Password → ถูกเติมเข้าไปข้างล่างนี้
//    4. environment variable              ConnectionStrings__DefaultConnection (Docker)
//
//  แยก password ออกจาก connection string เพราะ appsettings.Development.json
//  ถูก commit ลง git ส่วน host/port/database ไม่ใช่ความลับ — มันคือ topology
//  ของ dev environment ที่ "ควรอ่านเจอในโค้ด" ไม่ใช่ซ่อนอยู่ในเครื่องใครคนหนึ่ง
// ═══════════════════════════════════════════════════════════════════════════
public static class PersistenceConfiguration
{
    public static IServiceCollection AddPersistence(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var configured = configuration.GetConnectionString("DefaultConnection");

        // ⚠️ ต้องเช็ค IsNullOrWhiteSpace ไม่ใช่ `?? throw` — appsettings.json
        //    ประกาศ key นี้ไว้เป็นสตริงว่าง ค่าที่ได้จึงเป็น "" ไม่ใช่ null และ
        //    `?? throw` จะไม่ทำงาน ปล่อยให้ไปพังทีหลังตอน Npgsql เปิด connection
        //    ด้วย error ที่ไม่บอกอะไร ("Host can't be null")
        if (string.IsNullOrWhiteSpace(configured))
        {
            throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection ไม่ได้ตั้งค่า — " +
                "dev: รัน `pwsh scripts/setup-secrets.ps1` (หรือ `bash scripts/setup-secrets.sh`) | " +
                "Docker: ตรวจ env ConnectionStrings__DefaultConnection ใน docker-compose.yml");
        }

        var connectionString = ApplySecretPassword(configured, configuration["Postgres:Password"]);

        services.AddDbContext<AppDbContext>(options =>
        {
            options.UseNpgsql(connectionString, npgsql =>
            {
                // migration history อยู่ใน schema เดียวกับตารางอื่น
                npgsql.MigrationsHistoryTable("__ef_migrations_history");

                // retry เฉพาะ error ที่ retry ได้ (connection drop, timeout)
                // ไม่ retry unique-violation หรือ FK-violation
                npgsql.EnableRetryOnFailure(maxRetryCount: 3,
                                            maxRetryDelay: TimeSpan.FromSeconds(5),
                                            errorCodesToAdd: null);
            });

            // snake_case ทั้งตารางและคอลัมน์ — PascalCase ใน Postgres ต้องใส่
            // double quote ทุกครั้งที่เขียน SQL ดิบ ซึ่งเรามีเยอะ (PGroonga,
            // view query, index) เลยไม่คุ้ม
            options.UseSnakeCaseNamingConvention();
        });

        return services;
    }

    /// <summary>
    /// เติม password จาก secret store เข้า connection string ที่ยังไม่มี password
    /// </summary>
    /// <remarks>
    /// ⚠️ ถ้า connection string มี password มาแล้วจะไม่แตะ — env var ของ Docker
    ///    ต้องชนะเสมอ ไม่ให้ secret ที่ค้างอยู่ในเครื่อง dev มาแย่งที่ (เครื่อง
    ///    เดียวกันรันได้ทั้ง `dotnet run` และ `docker compose up`)
    /// </remarks>
    private static string ApplySecretPassword(string connectionString, string? password)
    {
        if (string.IsNullOrEmpty(password)) return connectionString;

        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        if (!string.IsNullOrEmpty(builder.Password)) return connectionString;

        builder.Password = password;
        return builder.ConnectionString;
    }
}
