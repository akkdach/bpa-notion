using System.Reflection;

namespace ProjectManagementAPI.Data.Migrations;

// ═══════════════════════════════════════════════════════════════════════════
//  โหลดไฟล์ .sql ที่ฝังเป็น embedded resource
//
//  ทำไมไม่อ่านจาก disk: path ตอน `dotnet ef` (bin/Debug) ต่างจากตอนรันใน
//  container (/app) และ Dockerfile ไม่ได้ copy โฟลเดอร์ Sql ไปด้วย
//  ผลคือ migration ที่ผ่านบนเครื่องแต่พังตอน deploy
// ═══════════════════════════════════════════════════════════════════════════
internal static class MigrationSql
{
    private const string ResourcePrefix = "ProjectManagementAPI.Data.Migrations.Sql.";

    public static string Load(string fileName)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = ResourcePrefix + fileName;

        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException(
                $"ไม่พบ embedded resource '{resourceName}'\n" +
                $"resource ที่มี: {string.Join(", ", assembly.GetManifestResourceNames())}\n" +
                "ตรวจว่า csproj มี <EmbeddedResource Include=\"Data\\Migrations\\Sql\\*.sql\" />");

        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
