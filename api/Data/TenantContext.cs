using ProjectManagementAPI.Domain;

namespace ProjectManagementAPI.Data;

/// <summary>
/// scoped — หนึ่ง instance ต่อ HTTP request และต่อ SignalR hub invocation
///
/// ตั้งค่าโดย TenantResolutionMiddleware (REST) หรือโดย DocHub เอง (realtime
/// ซึ่งไม่มี HttpContext ให้อ่าน)
/// </summary>
public class TenantContext : ITenantContext, ITenantContextSetter
{
    public Guid? WorkspaceId { get; private set; }
    public Guid? UserId { get; private set; }
    public WorkspaceRole? WorkspaceRole { get; private set; }

    public void SetUser(Guid userId) => UserId = userId;

    public void SetWorkspace(Guid workspaceId, WorkspaceRole role)
    {
        WorkspaceId = workspaceId;
        WorkspaceRole = role;
    }

    public Guid RequireWorkspaceId() => WorkspaceId
        ?? throw new InvalidOperationException(
            "request นี้ไม่มี workspace context — ต้องส่ง header X-Workspace-Id " +
            "และ endpoint ต้องอยู่หลัง TenantResolutionMiddleware");

    public Guid RequireUserId() => UserId
        ?? throw new InvalidOperationException(
            "request นี้ไม่มี user context — endpoint ต้องมี [Authorize]");
}
