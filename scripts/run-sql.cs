#:package Npgsql@10.0.3
#:package Microsoft.Extensions.Configuration.Json@10.0.0
#:package Microsoft.Extensions.Configuration.UserSecrets@10.0.0
#:package Microsoft.Extensions.Configuration.EnvironmentVariables@10.0.0

// ═══════════════════════════════════════════════════════════════════════════
//  รันไฟล์ .sql กับฐานข้อมูลที่ api ชี้อยู่
//
//      dotnet run scripts/run-sql.cs db/init/001_extensions.sql
//      dotnet run scripts/run-sql.cs db/probe/thai-search-probe.sql
//      echo "SELECT 1" | dotnet run scripts/run-sql.cs - --quiet
//
//  ทำไมต้องมี: db/init/*.sql ถูกรันอัตโนมัติเฉพาะตอน docker สร้าง volume ใหม่
//  เท่านั้น ถ้าปลายทางเป็น PostgreSQL ที่ติดตั้งเอง (เครื่อง on-prem, VM) ไม่มี
//  อะไรรันให้เลย และ EF migrations ก็สร้าง extension ให้ไม่ได้เพราะต้องมีก่อน
//  migration แรกจะทำงาน
//
//  ⚠️ อ่าน connection string ผ่าน configuration ชุดเดียวกับ api ทุกประการ
//     (appsettings → appsettings.Development → User Secrets → env var)
//     เพื่อไม่ให้เกิดกรณี "รัน SQL ลงฐานหนึ่ง แต่แอปคุยอีกฐานหนึ่ง"
//
//  ส่งทั้งไฟล์เป็นคำสั่งเดียว ไม่ตัดที่ ';' เอง — ให้ PostgreSQL เป็นคนแยก
//  statement เพราะบล็อก DO $$ … $$ มี ';' อยู่ข้างในและการตัดเองจะพัง
// ═══════════════════════════════════════════════════════════════════════════

using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Npgsql;

if (args.Length < 1)
{
    Console.Error.WriteLine("ใช้: dotnet run scripts/run-sql.cs <ไฟล์.sql|-> [--quiet]");
    return 2;
}

// --quiet: ไม่พิมพ์ banner และผลลัพธ์ ใช้ตอนถูกเรียกจากสคริปต์อื่น (error ยังพิมพ์)
var quiet = args.Contains("--quiet");
var root = FindRepoRoot();
var fromStdin = args[0] == "-";

string sqlText;
string label;

if (fromStdin)
{
    sqlText = await Console.In.ReadToEndAsync();
    label = "(stdin)";
}
else
{
    var sqlPath = Path.GetFullPath(args[0], root);
    if (!File.Exists(sqlPath))
    {
        Console.Error.WriteLine($"ไม่พบไฟล์: {sqlPath}");
        return 2;
    }
    sqlText = await File.ReadAllTextAsync(sqlPath);
    label = Path.GetRelativePath(root, sqlPath).Replace('\\', '/');
}

// ─── connection string: ลำดับเดียวกับ api ────────────────────────────────
var apiDir = Path.Combine(root, "api");
var configuration = new ConfigurationBuilder()
    .SetBasePath(apiDir)
    .AddJsonFile("appsettings.json", optional: false)
    .AddJsonFile("appsettings.Development.json", optional: true)
    .AddUserSecrets(ReadUserSecretsId(Path.Combine(apiDir, "ProjectManagementAPI.csproj")))
    .AddEnvironmentVariables()
    .Build();

var raw = configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(raw))
{
    Console.Error.WriteLine("ConnectionStrings:DefaultConnection ไม่ได้ตั้งค่า");
    return 2;
}

var builder = new NpgsqlConnectionStringBuilder(raw);
if (string.IsNullOrEmpty(builder.Password))
    builder.Password = configuration["Postgres:Password"];

// ─── บอกปลายทางให้ชัดก่อนแตะอะไร ─────────────────────────────────────────
// migration ที่ลงผิดฐานคือความเสียหายที่ไม่มีใครสังเกตจนสายเกินไป
if (!quiet)
{
    Console.WriteLine();
    Console.WriteLine($"  ไฟล์    {label}");
    Console.WriteLine($"  ปลายทาง {builder.Host}:{builder.Port}/{builder.Database} (user {builder.Username})");
    Console.WriteLine();
}

await using var source = new NpgsqlDataSourceBuilder(builder.ConnectionString).Build();
await using var conn = await source.OpenConnectionAsync();

// RAISE NOTICE ของ DO block มาทางนี้ — ไม่ subscribe แล้วจะไม่เห็นอะไรเลย
if (!quiet) conn.Notice += (_, e) => Console.WriteLine($"  {e.Notice.Severity}: {e.Notice.MessageText}");

try
{
    await using var cmd = new NpgsqlCommand(StripPsqlMetaCommands(sqlText), conn);
    cmd.CommandTimeout = 300;

    await using var reader = await cmd.ExecuteReaderAsync();
    do
    {
        if (reader.FieldCount == 0 || quiet) continue;

        Console.WriteLine("  " + string.Join("  |  ",
            Enumerable.Range(0, reader.FieldCount).Select(reader.GetName)));

        while (await reader.ReadAsync())
        {
            Console.WriteLine("  " + string.Join("  |  ", Enumerable.Range(0, reader.FieldCount)
                .Select(i => reader.IsDBNull(i) ? "NULL" : Render(reader.GetValue(i)))));
        }
        Console.WriteLine();
    } while (await reader.NextResultAsync());
}
catch (PostgresException ex)
{
    Console.Error.WriteLine();
    Console.Error.WriteLine($"  ✗ {ex.SqlState}: {ex.MessageText}");
    if (ex.Detail is not null) Console.Error.WriteLine($"    รายละเอียด: {ex.Detail}");
    if (ex.Hint is not null) Console.Error.WriteLine($"    คำแนะนำ: {ex.Hint}");
    if (ex.Position > 0) Console.Error.WriteLine($"    ตำแหน่ง: อักขระที่ {ex.Position}");
    return 1;
}

if (!quiet) Console.WriteLine("  ✓ รันจบ");
return 0;

/// <summary>
/// แสดงค่าให้อ่านออก — array ต้องกางเป็น {a,b,c} ไม่ใช่ "System.Int32[]"
/// </summary>
/// <remarks>
/// schema นี้ใช้ array จริงจัง (pages.ancestor_ids uuid[]) ค่าที่อ่านไม่ออก
/// ทำให้เครื่องมือตรวจสอบใช้ตรวจสอบอะไรไม่ได้เลย
/// </remarks>
static string Render(object value) => value switch
{
    string s => s,                                   // string เป็น IEnumerable ต้องดักก่อน
    System.Collections.IEnumerable items =>
        "{" + string.Join(",", items.Cast<object?>().Select(x => x?.ToString() ?? "NULL")) + "}",
    _ => value.ToString() ?? "",
};

/// <summary>
/// ตัดคำสั่งของ psql เอง (บรรทัดที่ขึ้นต้นด้วย \ เช่น \set, \echo, \timing) ทิ้ง
/// </summary>
/// <remarks>
/// คำสั่งพวกนี้ psql ตีความเองก่อนส่ง ไม่ใช่ SQL ที่เซิร์ฟเวอร์รู้จัก ส่งไปตรง ๆ
/// จะได้ 42601 syntax error at or near "\"
///
/// ไฟล์ .sql ในโปรเจกต์นี้ต้องรันได้ทั้งผ่าน psql (CI ใช้) และผ่านสคริปต์นี้
/// (ปลายทางที่ไม่มี psql) จึงตัดออกที่นี่แทนที่จะไปแก้ไฟล์ .sql
///
/// แทนที่ด้วยช่องว่างจำนวนเท่าเดิม ไม่ใช่ลบทิ้ง เพื่อให้ Position ที่ PostgreSQL
/// รายงานตอน error ยังตรงกับตำแหน่งจริงในไฟล์
/// </remarks>
static string StripPsqlMetaCommands(string sql) =>
    string.Join('\n', sql.Split('\n').Select(line =>
        line.TrimStart().StartsWith('\\') ? new string(' ', line.Length) : line));

static string FindRepoRoot()
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "docker-compose.yml")))
        dir = dir.Parent;

    // build output ของ file-based app อยู่นอก repo — ถอยไปหาจาก cwd แทน
    return dir?.FullName ?? Directory.GetCurrentDirectory();
}

static string ReadUserSecretsId(string csprojPath)
{
    var match = Regex.Match(File.ReadAllText(csprojPath), @"<UserSecretsId>([^<]+)</UserSecretsId>");
    if (!match.Success) throw new InvalidOperationException($"ไม่พบ <UserSecretsId> ใน {csprojPath}");
    return match.Groups[1].Value.Trim();
}
