using Microsoft.EntityFrameworkCore;
using ProjectManagementAPI.Data;

namespace ProjectManagementAPI.Configurations;

// ═══════════════════════════════════════════════════════════════════════════
//  EF Core + PostgreSQL
// ═══════════════════════════════════════════════════════════════════════════
public static class PersistenceConfiguration
{
    public static IServiceCollection AddPersistence(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection ไม่ได้ตั้งค่า");

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
}
