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
//  · login ครั้งเดียว cache access token ไว้ ต่ออายุอัตโนมัติเมื่อใกล้หมด
//  · แนบ Authorization + X-Workspace-Id ให้ทุก request ที่ผูก workspace
//  · แกะ envelope { success, data, message, code } ให้เหลือแค่ data
//
//  ทุก error โยนเป็น InvalidOperationException พร้อมข้อความไทย ซึ่ง MCP
//  ส่งกลับให้ Claude อ่านได้ตรง ๆ
// ═══════════════════════════════════════════════════════════════════════════
public sealed class PmClient(IConfiguration configuration)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http = new();
    private readonly SemaphoreSlim _authLock = new(1, 1);

    private string? _token;
    private DateTimeOffset _tokenExpiresAt;
    private Guid _workspaceId;

    public string WorkspaceName { get; private set; } = "";

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

    private string Require(string secretKey, string envKey) =>
        Setting(secretKey, envKey)
        ?? throw new InvalidOperationException(
            $"ยังไม่ได้ตั้ง {secretKey} — รัน `pwsh scripts/setup-mcp.ps1` " +
            $"(หรือตั้ง environment variable {envKey})");

    // ─── auth ────────────────────────────────────────────────────────────

    private async Task EnsureAuthAsync(CancellationToken ct)
    {
        // เผื่อ clock skew + latency: ต่ออายุก่อนหมดจริง 1 นาที
        if (_token is not null && DateTimeOffset.UtcNow < _tokenExpiresAt.AddMinutes(-1))
            return;

        await _authLock.WaitAsync(ct);
        try
        {
            if (_token is not null && DateTimeOffset.UtcNow < _tokenExpiresAt.AddMinutes(-1))
                return;

            await LoginAsync(ct);
        }
        finally
        {
            _authLock.Release();
        }
    }

    private async Task LoginAsync(CancellationToken ct)
    {
        var email = Require("Pm:Email", "PM_EMAIL");
        var password = Require("Pm:Password", "PM_PASSWORD");
        var wanted = Setting("Pm:Workspace", "PM_WORKSPACE");

        HttpResponseMessage resp;
        try
        {
            resp = await _http.PostAsJsonAsync(
                $"{BaseUrl}/api/v1/auth/login", new { email, password }, Json, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new InvalidOperationException(
                $"ต่อ API ไม่ได้ที่ {BaseUrl} — เปิดเซิร์ฟเวอร์แล้วหรือยัง? " +
                $"(`dotnet run --project api` หรือ `docker compose up -d`) ({ex.Message})");
        }

        var body = await resp.Content.ReadFromJsonAsync<Envelope<AuthResponse>>(Json, ct);

        if (!resp.IsSuccessStatusCode || body?.Data is null)
        {
            throw new InvalidOperationException(
                $"login ล้มเหลว: {body?.Message ?? resp.StatusCode.ToString()}");
        }

        _token = body.Data.AccessToken;
        _tokenExpiresAt = body.Data.AccessTokenExpiresAt;

        var ws = ResolveWorkspace(body.Data.Workspaces, wanted);
        _workspaceId = ws.Id;
        WorkspaceName = ws.Name;
    }

    private static WorkspaceSummary ResolveWorkspace(
        IReadOnlyList<WorkspaceSummary> workspaces, string? wanted)
    {
        if (workspaces.Count == 0)
            throw new InvalidOperationException("บัญชีนี้ยังไม่มี workspace");

        if (string.IsNullOrWhiteSpace(wanted))
        {
            if (workspaces.Count == 1) return workspaces[0];

            var names = string.Join(", ", workspaces.Select(w => $"{w.Name} ({w.Slug})"));
            throw new InvalidOperationException(
                $"มีหลาย workspace — ตั้ง env PM_WORKSPACE เป็น slug หรือ GUID ให้ชัด: {names}");
        }

        var match = workspaces.FirstOrDefault(w =>
            string.Equals(w.Slug, wanted, StringComparison.OrdinalIgnoreCase) ||
            w.Id.ToString().Equals(wanted, StringComparison.OrdinalIgnoreCase));

        if (match is null)
        {
            var names = string.Join(", ", workspaces.Select(w => $"{w.Name} ({w.Slug})"));
            throw new InvalidOperationException(
                $"ไม่พบ workspace '{wanted}' — ที่มี: {names}");
        }

        return match;
    }

    // ─── HTTP core ─────────────────────────────────────────────────────────

    /// <summary>
    /// ยิง request หนึ่งครั้ง ถ้าได้ 401 ให้ login ใหม่แล้วลองอีกครั้งเดียว
    /// </summary>
    /// <remarks>
    /// ⚠️ ต้องมี retry จริง ๆ ไม่ใช่แค่ชื่อ — MCP server เป็น process ที่อยู่ยาว
    /// ตลอด session ของ Claude Code ส่วน access token อายุ 24 ชม. และ
    /// ClockSkew ฝั่ง API ตั้งเป็นศูนย์
    ///
    /// การเช็ควันหมดอายุล่วงหน้า 1 นาทีกันได้แค่ token ที่ "หมดอายุตามกำหนด"
    /// แต่กันไม่ได้เมื่อ API restart แล้วเปลี่ยน JWT key, refresh token ถูก
    /// revoke, หรือบัญชีถูกถอดออกจาก workspace — เคสพวกนี้ token ที่ cache ไว้
    /// ใช้ไม่ได้ทันทีทั้งที่ยังไม่หมดอายุ ไม่มี retry แปลว่าทุก tool พังยาว
    /// จนกว่าจะปิด Claude Code แล้วเปิดใหม่
    /// </remarks>
    private async Task<T> SendAsync<T>(
        HttpMethod method, string path, object? payload, CancellationToken ct)
    {
        await EnsureAuthAsync(ct);

        var (ok, value) = await TrySendAsync<T>(method, path, payload, ct);
        if (ok) return value!;

        // 401 — บังคับ login ใหม่ (ล้าง token ก่อน ไม่งั้น EnsureAuth จะเห็นว่า
        // ยังไม่หมดอายุแล้วข้ามไป) แล้วลองอีกครั้ง ครั้งเดียวพอ ถ้ายัง 401 อีก
        // แปลว่า credential ผิดจริง ไม่ใช่ token เก่า
        _token = null;
        await EnsureAuthAsync(ct);

        var (retryOk, retryValue) = await TrySendAsync<T>(method, path, payload, ct, throwOn401: true);
        return retryOk ? retryValue! : throw new UnreachableException();
    }

    private async Task<(bool Ok, T? Value)> TrySendAsync<T>(
        HttpMethod method, string path, object? payload, CancellationToken ct, bool throwOn401 = false)
    {
        using var req = new HttpRequestMessage(method, $"{BaseUrl}{path}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        req.Headers.Add("X-Workspace-Id", _workspaceId.ToString());
        if (payload is not null)
            req.Content = JsonContent.Create(payload, options: Json);

        using var resp = await _http.SendAsync(req, ct);

        if (resp.StatusCode == HttpStatusCode.Unauthorized && !throwOn401)
            return (false, default);

        var body = await ReadEnvelopeAsync<T>(resp, ct);

        if (!resp.IsSuccessStatusCode || body is null || body.Success == false)
        {
            throw new InvalidOperationException(
                $"API {(int)resp.StatusCode}: {body?.Message ?? resp.ReasonPhrase} " +
                $"({body?.Code ?? "no_code"})");
        }

        return (true, body.Data ?? throw new InvalidOperationException("API ตอบสำเร็จแต่ไม่มี data"));
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
    public Task<AppendResult> AppendParagraphsAsync(
        Guid pageId, IReadOnlyList<string> paragraphs, CancellationToken ct)
        => SendAsync<AppendResult>(HttpMethod.Post,
            $"/api/v1/pages/{pageId}/content/paragraphs", new { paragraphs }, ct);
}
