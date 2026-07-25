namespace ProjectManagementAPI.Configurations;

// ═══════════════════════════════════════════════════════════════════════════
//  SignalR — Yjs relay transport
//
//  SignalR server เองอยู่ใน framework แล้ว ที่เพิ่มคือ MessagePack protocol
//  เพื่อให้ byte[] วิ่งเป็น binary ตรง ๆ ไม่ใช่ base64 ใน JSON
// ═══════════════════════════════════════════════════════════════════════════
public static class RealtimeConfiguration
{
    /// <summary>
    /// ⚠️ ค่า default ของ SignalR คือ 32 KB ซึ่ง "เล็กเกินไป" สำหรับงานนี้
    ///
    /// client ที่ offline ไปแล้วกลับมาต่อ จะส่ง full state (Y.encodeStateAsUpdate)
    /// ก้อนเดียว ซึ่งใหญ่กว่า 32 KB ได้ง่าย ๆ อาการคือ connection ปิดพร้อม error
    /// ที่อ่านไม่รู้เรื่อง และ "เกิดกับ user ที่ offline เท่านั้น" — คือไม่เคย
    /// เกิดตอนเราเทสเลย ต้องตั้งค่านี้ตั้งแต่วันแรก
    /// </summary>
    private const long MaxReceiveMessageSize = 4 * 1024 * 1024;  // 4 MB

    public static IServiceCollection AddRealtime(this IServiceCollection services)
    {
        services
            .AddSignalR(options =>
            {
                options.MaximumReceiveMessageSize = MaxReceiveMessageSize;

                // dev: ส่ง exception detail กลับไปให้ client เห็น
                options.EnableDetailedErrors = false;

                // client ping ทุก 15s → ถ้าเงียบเกิน 30s ถือว่าหลุด
                options.KeepAliveInterval = TimeSpan.FromSeconds(15);
                options.ClientTimeoutInterval = TimeSpan.FromSeconds(30);
            })
            .AddMessagePackProtocol();

        return services;
    }

    public static WebApplication MapRealtimeHubs(this WebApplication app)
    {
        // ─────────────────────────────────────────────────────────────────
        //  Phase 2 — DocHub
        //
        //  app.MapHub<DocHub>("/hubs/doc", options =>
        //  {
        //      options.ApplicationMaxBufferSize = MaxReceiveMessageSize;
        //      options.TransportMaxBufferSize   = MaxReceiveMessageSize;
        //      // ตัด connection เมื่อ token หมดอายุ แล้วให้ client reconnect
        //      // ด้วย token ใหม่ — กัน connection อายุยาวที่รอด ACL change ไปได้
        //      options.CloseOnAuthenticationExpiration = true;
        //  });
        //
        //  ⚠️ ตอน reconnect กลุ่ม (SignalR group) จะหายไป client ต้องเรียก
        //     JoinDocument ใหม่ทุกครั้งใน onreconnected — ดู PLAN.md Risk #2
        // ─────────────────────────────────────────────────────────────────

        return app;
    }
}
