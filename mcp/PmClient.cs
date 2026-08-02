using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace ProjectManagementMcp;

// ═══════════════════════════════════════════════════════════════════════════
//  PmClient — ตัวเชื่อม REST API ของ ProjectManagement (api/)
//
//  · ยืนยันตัวตนด้วย API token ใบเดียว (`pmt_…`) ไม่มีการ login ไม่มี session
//  · แกะ envelope { success, data, message, code } ให้เหลือแค่ data
//
//  ⚠️ ไม่ส่ง X-Workspace-Id — ตัว token ผูกกับ workspace อยู่แล้ว เซิร์ฟเวอร์
//     อ่านจาก token และปฏิเสธถ้า header ชี้ไปคนละที่ (token_workspace_mismatch)
//     การไม่ส่งจึงทั้งง่ายกว่าและกันความผิดพลาดได้ในตัว
//
//  ⚠️ เดิมเก็บอีเมล+รหัสผ่านของบัญชี AI ไว้บนดิสก์แล้ว login เอง เปลี่ยนมาใช้
//     token เพราะรหัสผ่านเพิกถอนรายเครื่องไม่ได้ ไม่มีวันหมดอายุ และต้องคัดลอก
//     ส่งต่อกันเมื่อมีหลายเครื่อง
//
//  ทุก error โยนเป็น InvalidOperationException พร้อมข้อความไทย ซึ่ง MCP
//  ส่งกลับให้ Claude อ่านได้ตรง ๆ
// ═══════════════════════════════════════════════════════════════════════════
public sealed class PmClient(IConfiguration configuration)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http = new();
    private readonly SemaphoreSlim _workspaceLock = new(1, 1);

    private string? _workspaceName;

    /// <summary>
    /// ชื่อ workspace ที่ token ใบนี้ผูกอยู่ — ดึงครั้งแรกที่ถามแล้ว cache ไว้
    /// </summary>
    /// <remarks>
    /// เดิมได้มาฟรีจาก response ของ login ตอนนี้ไม่มี login แล้วจึงต้องถามเอง
    /// ทำแบบ lazy เพราะ tool ส่วนใหญ่ไม่ได้ใช้ชื่อนี้ — ไม่ควรจ่ายค่า request
    /// เพิ่มให้ทุกคำสั่งเพื่อข้อความบรรทัดเดียว
    /// </remarks>
    public async Task<string> GetWorkspaceNameAsync(CancellationToken ct)
    {
        if (_workspaceName is not null) return _workspaceName;

        await _workspaceLock.WaitAsync(ct);
        try
        {
            _workspaceName ??= (await SendAsync<WorkspaceSummary>(
                HttpMethod.Get, "/api/v1/workspaces/current", null, ct)).Name;

            return _workspaceName;
        }
        finally
        {
            _workspaceLock.Release();
        }
    }

    /// <summary>
    /// อ่านค่าจาก User Secrets ก่อน แล้วค่อยตกไป env var
    /// </summary>
    /// <remarks>
    /// รองรับสองรูปแบบเพราะใช้คนละสถานการณ์: User Secrets สำหรับเครื่อง dev
    /// (ตั้งครั้งเดียว ใช้ได้ทุก shell ไม่หลุดขึ้น git) ส่วน env var สำหรับตอน
    /// รันใน container หรือ CI ที่ไม่มี secret store
    ///
    /// เรียงแบบนี้เพื่อให้ตั้ง env var ทับชั่วคราวไม่ได้โดยบังเอิญ — ถ้าอยาก
    /// override จริง ๆ ให้แก้ที่ secret store ซึ่งเป็นที่เดียวที่ควรมีค่าจริง
    /// </remarks>
    private string? Setting(string secretKey, string envKey) =>
        configuration[secretKey] is { Length: > 0 } fromSecrets
            ? fromSecrets
            : configuration[envKey] is { Length: > 0 } fromEnv ? fromEnv : null;

    private string BaseUrl =>
        (Setting("Pm:ApiUrl", "PM_API_URL") ?? "http://localhost:5081").TrimEnd('/');

    // ─── auth ────────────────────────────────────────────────────────────

    /// <summary>
    /// API token ที่ออกจากหน้า ตั้งค่า → การเชื่อมต่อ AI
    /// </summary>
    /// <remarks>
    /// ⚠️ ไม่มีการ login ไม่มี session ไม่มีวันหมดอายุที่ต้องต่อเอง — token ใบเดียว
    ///    ใช้ตรง ๆ ทุกคำขอ ถ้ามันถูกเพิกถอน คำขอถัดไปได้ 401 ทันที ซึ่งเป็น
    ///    พฤติกรรมที่ต้องการ (เพิกถอนแล้วต้องมีผลเดี๋ยวนั้น ไม่ใช่รอ token หมดอายุ)
    /// </remarks>
    private string Token => Setting("Pm:Token", "PM_TOKEN") ?? throw MissingToken();

    private InvalidOperationException MissingToken()
    {
        // ─────────────────────────────────────────────────────────────────
        //  ถ้าเจอค่าแบบเก่าให้บอกตรง ๆ ว่าเปลี่ยนวิธีแล้ว
        //
        //  คนที่อัปเดตมาจากรุ่นก่อนจะมี Pm:Email / Pm:Password ค้างอยู่ แล้วเจอ
        //  "ยังไม่ได้ตั้ง Pm:Token" ซึ่งอ่านแล้วงงว่าทำไมของที่เคยใช้ได้ถึงพัง
        //  — บอกทางแก้ให้ตรงจุดดีกว่าปล่อยให้ไปเดาเอง
        // ─────────────────────────────────────────────────────────────────
        var hasLegacy = Setting("Pm:Email", "PM_EMAIL") is not null
            || Setting("Pm:Password", "PM_PASSWORD") is not null;

        return new InvalidOperationException(hasLegacy
            ? "ระบบเปลี่ยนจากการ login ด้วยรหัสผ่านมาใช้ API token แล้ว — สร้าง token " +
              "ที่หน้า ตั้งค่า → การเชื่อมต่อ AI แล้วรัน setup-mcp.ps1 ใหม่"
            : "ยังไม่ได้ตั้ง Pm:Token — สร้าง token ที่หน้า ตั้งค่า → การเชื่อมต่อ AI " +
              "แล้วรัน setup-mcp.ps1 (หรือตั้ง environment variable PM_TOKEN)");
    }

    // ─── HTTP core ─────────────────────────────────────────────────────────

    /// <summary>
    /// ยิง request หนึ่งครั้ง — ไม่มี retry เพราะไม่มี session ให้ต่ออายุ
    /// </summary>
    /// <remarks>
    /// ⚠️ ของเดิม (login ด้วยรหัสผ่าน) ต้องมี retry เมื่อเจอ 401 เพราะ access token
    ///    ที่ cache ไว้หมดอายุหรือใช้ไม่ได้ได้หลายทาง แล้วต้อง login ใหม่เอง
    ///
    ///    API token ไม่มีเรื่องนั้นเลย: 401 แปลว่า "ใบนี้ใช้ไม่ได้แล้ว" จริง ๆ
    ///    (ถูกเพิกถอน หมดอายุ หรือบัญชีถูกถอดออกจาก workspace) การลองซ้ำจึงได้
    ///    ผลเดิมเสมอ — บอกสาเหตุให้ชัดแล้วให้คนไปสร้างใบใหม่ดีกว่า
    /// </remarks>
    private async Task<T> SendAsync<T>(
        HttpMethod method, string path, object? payload, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, $"{BaseUrl}{path}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);

        // ไม่ส่ง X-Workspace-Id — token บอก workspace เองแล้ว
        if (payload is not null)
            req.Content = JsonContent.Create(payload, options: Json);

        HttpResponseMessage resp;
        try
        {
            resp = await _http.SendAsync(req, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new InvalidOperationException(
                $"ต่อ API ไม่ได้ที่ {BaseUrl} — เปิดเซิร์ฟเวอร์แล้วหรือยัง? " +
                $"(`dotnet run --project api` หรือ `docker compose up -d`) ({ex.Message})");
        }

        using var _ = resp;

        if (resp.StatusCode == HttpStatusCode.Unauthorized)
        {
            throw new InvalidOperationException(
                "API token ใช้ไม่ได้ — อาจถูกเพิกถอน หมดอายุ หรือบัญชีถูกถอดออกจาก " +
                "workspace แล้ว สร้างใบใหม่ที่หน้า ตั้งค่า → การเชื่อมต่อ AI");
        }

        var body = await ReadEnvelopeAsync<T>(resp, ct);

        if (!resp.IsSuccessStatusCode || body is null || body.Success == false)
        {
            throw new InvalidOperationException(
                $"API {(int)resp.StatusCode}: {body?.Message ?? resp.ReasonPhrase} " +
                $"({body?.Code ?? "no_code"})");
        }

        return body.Data ?? throw new InvalidOperationException("API ตอบสำเร็จแต่ไม่มี data");
    }

    /// <summary>
    /// แกะ envelope โดยทน response ที่ไม่ใช่ JSON
    /// </summary>
    /// <remarks>
    /// 401 จาก JwtBearer middleware ไม่ผ่าน ApiExceptionFilter จึงไม่มี body
    /// เป็น envelope ให้แกะ ปล่อยให้ ReadFromJsonAsync โยนออกมาจะได้ error
    /// เรื่อง JSON ที่ไม่เกี่ยวกับสาเหตุจริงเลย
    /// </remarks>
    private static async Task<Envelope<T>?> ReadEnvelopeAsync<T>(
        HttpResponseMessage resp, CancellationToken ct)
    {
        try
        {
            return await resp.Content.ReadFromJsonAsync<Envelope<T>>(Json, ct);
        }
        catch (JsonException)
        {
            return null;
        }
        catch (NotSupportedException)   // content-type ไม่ใช่ JSON
        {
            return null;
        }
    }

    // ─── ops ที่ tools เรียก ────────────────────────────────────────────────

    public Task<List<PageNode>> GetTreeAsync(CancellationToken ct)
        => SendAsync<List<PageNode>>(HttpMethod.Get, "/api/v1/pages", null, ct);

    public Task<PageDto> GetPageAsync(Guid pageId, CancellationToken ct)
        => SendAsync<PageDto>(HttpMethod.Get, $"/api/v1/pages/{pageId}", null, ct);

    /// <summary>สร้างหน้าพร้อมสถานะในคำขอเดียว — status = null คือหน้าปกติที่ไม่ใช่งาน</summary>
    public Task<PageDto> CreatePageAsync(
        Guid? parentId, string title, string? icon, string? status, CancellationToken ct)
        => SendAsync<PageDto>(HttpMethod.Post, "/api/v1/pages",
            new { parentId, title, icon, afterPageId = (Guid?)null, status }, ct);

    /// <summary>ส่งเฉพาะ field ที่ไม่ null — field ที่ null เซิร์ฟเวอร์จะไม่แตะ</summary>
    public Task<PageDto> UpdatePageAsync(
        Guid pageId, string? title, string? icon, string? status, CancellationToken ct)
        => SendAsync<PageDto>(HttpMethod.Patch, $"/api/v1/pages/{pageId}",
            new { title, icon, status }, ct);

    /// <summary>เนื้อหาหน้าเป็น plain text (projection ที่เบราว์เซอร์แกะจาก Y.Doc)</summary>
    public Task<PageContent> GetContentAsync(Guid pageId, CancellationToken ct)
        => SendAsync<PageContent>(HttpMethod.Get, $"/api/v1/pages/{pageId}/content", null, ct);

    /// <summary>ค้นหาด้วย PGroonga — เซิร์ฟเวอร์ escape อักขระพิเศษให้แล้ว</summary>
    public Task<SearchResult> SearchAsync(
        string query, string? status, int limit, CancellationToken ct)
    {
        var path = $"/api/v1/search?q={Uri.EscapeDataString(query)}&limit={limit}";
        if (!string.IsNullOrWhiteSpace(status)) path += $"&status={Uri.EscapeDataString(status)}";

        return SendAsync<SearchResult>(HttpMethod.Get, path, null, ct);
    }

    /// <summary>ย้ายหน้าพร้อมลูกหลาน — parentId = null คือย้ายขึ้นระดับบนสุด</summary>
    public Task<MoveResult> MovePageAsync(
        Guid pageId, Guid? parentId, Guid? afterPageId, CancellationToken ct)
        => SendAsync<MoveResult>(HttpMethod.Post, $"/api/v1/pages/{pageId}/move",
            new { parentId, afterPageId }, ct);

    /// <summary>ย้ายไปถังขยะพร้อมลูกหลาน — คืนจำนวนหน้าที่ถูกลบ</summary>
    public Task<int> DeletePageAsync(Guid pageId, CancellationToken ct)
        => SendAsync<int>(HttpMethod.Delete, $"/api/v1/pages/{pageId}", null, ct);

    /// <summary>กู้คืนจากถังขยะพร้อมลูกหลาน — คืนจำนวนหน้าที่กู้</summary>
    public Task<int> RestorePageAsync(Guid pageId, CancellationToken ct)
        => SendAsync<int>(HttpMethod.Post, $"/api/v1/pages/{pageId}/restore", null, ct);

    public Task<List<PageNode>> GetTrashAsync(CancellationToken ct)
        => SendAsync<List<PageNode>>(HttpMethod.Get, "/api/v1/pages/trash", null, ct);

    /// <summary>บันทึกบนหน้า เรียงเก่าไปใหม่</summary>
    public Task<List<PageNote>> GetNotesAsync(Guid pageId, CancellationToken ct)
        => SendAsync<List<PageNote>>(HttpMethod.Get, $"/api/v1/pages/{pageId}/notes", null, ct);

    /// <summary>เขียนบันทึกต่อท้ายหน้า — ต้องมีสิทธิ์แสดงความเห็นขึ้นไป</summary>
    public Task<PageNote> AddNoteAsync(Guid pageId, string body, CancellationToken ct)
        => SendAsync<PageNote>(HttpMethod.Post, $"/api/v1/pages/{pageId}/notes",
            new { body }, ct);

    /// <summary>ต่อท้ายย่อหน้าเข้าไปในเนื้อหาหน้าจริง (ไม่ใช่บันทึก)</summary>
    public Task<AppendResult> AppendMarkdownAsync(
        Guid pageId, string markdown, CancellationToken ct)
        => SendAsync<AppendResult>(HttpMethod.Post,
            $"/api/v1/pages/{pageId}/content/markdown", new { markdown }, ct);
}
