using System.Reflection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Protocol;
using ProjectManagementMcp;

// ═══════════════════════════════════════════════════════════════════════════
//  ProjectManagement MCP server (stdio)
//
//  ครอบ REST API ของแอป self-hosted (api/) ให้ Claude Code เรียกเป็น tools
//  ดู mcp/README.md
//
//  config มาจากสองที่ (User Secrets ชนะ env var):
//    Pm:ApiUrl / PM_API_URL   default http://localhost:5081
//    Pm:Token  / PM_TOKEN     * — API token จากหน้า ตั้งค่า → การเชื่อมต่อ AI
//
//  ไม่มีค่า workspace ให้ตั้ง: ขอบเขตมากับตัว token ใบหนึ่งใช้ได้กับ workspace เดียว
// ═══════════════════════════════════════════════════════════════════════════

var builder = Host.CreateApplicationBuilder(args);

// ─────────────────────────────────────────────────────────────────────────
//  ⚠️ ต้องเรียก AddUserSecrets เอง
//
//  Host.CreateApplicationBuilder โหลด Secret Manager ให้อัตโนมัติเฉพาะเมื่อ
//  environment เป็น Development เท่านั้น MCP server ถูก Claude Code สั่งรัน
//  ตรง ๆ โดยไม่มี DOTNET_ENVIRONMENT จึงตกเป็น Production และ secret หายไปเงียบ ๆ
//  อาการคือ "ยังไม่ได้ตั้ง Pm:Token" ทั้งที่ตั้งไปแล้ว
//
//  optional: true เพราะยังไม่ตั้ง secret ก็ต้อง start ได้ แล้วค่อยไปพังตอนเรียก
//  tool ครั้งแรก พร้อมข้อความที่บอกวิธีแก้ — ไม่ใช่พังตั้งแต่ handshake ซึ่ง
//  Claude Code จะขึ้นแค่ "server failed to start" โดยไม่บอกเหตุผล
// ─────────────────────────────────────────────────────────────────────────
builder.Configuration.AddUserSecrets(Assembly.GetExecutingAssembly(), optional: true);

// stdio ใช้ stdout เป็นช่องโปรโตคอล MCP — log ทุกอย่างต้องไป stderr เท่านั้น
// ไม่งั้น log จะปนกับ JSON-RPC แล้ว client parse ไม่ได้
builder.Logging.ClearProviders();
builder.Logging.AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Trace);

builder.Services.AddSingleton<PmClient>();

builder.Services
    .AddMcpServer(options =>
    {
        // ─────────────────────────────────────────────────────────────────
        //  ⚠️ ตั้งชื่อ/เวอร์ชันเอง ไม่ปล่อยให้ SDK เดาจากชื่อ assembly
        //
        //     ค่าเริ่มต้นคือชื่อ assembly ซึ่งเปลี่ยนตามวิธี build — verify-mcp
        //     build ด้วย -p:AssemblyName=ProjectManagementMcpVerify เพื่อเลี่ยง
        //     ไฟล์ที่ถูกล็อก แล้ว serverInfo.name ก็เปลี่ยนตามไปด้วย
        //     ชื่อ server ไม่ควรขึ้นกับรายละเอียดของการ build
        //
        //     ชื่อตรงกับคีย์ใน .mcp.json เพื่อให้ไล่ต้นทางได้ตอนมีหลาย server
        // ─────────────────────────────────────────────────────────────────
        options.ServerInfo = new Implementation
        {
            Name = "projectmanagement",
            Title = "ProjectManagement",
            // มาจาก <Version> ใน csproj ที่เดียว ไม่ใช่สตริงที่ต้องแก้สองที่
            Version = Assembly.GetExecutingAssembly()
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                ?? "0.0.0",
        };
    })
    .WithStdioServerTransport()
    .WithToolsFromAssembly();

await builder.Build().RunAsync();
