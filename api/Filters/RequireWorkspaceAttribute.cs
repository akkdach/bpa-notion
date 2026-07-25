using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Helpers;
using ProjectManagementAPI.Middlewares;

namespace ProjectManagementAPI.Filters;

// ═══════════════════════════════════════════════════════════════════════════
//  [RequireWorkspace]
//
//  บอกว่า endpoint นี้ทำงานภายใน workspace หนึ่ง ๆ เท่านั้น
//
//  ถ้าไม่มี attribute นี้แล้ว service ไปเรียก RequireWorkspaceId() จะได้
//  InvalidOperationException → 500 ซึ่งไม่บอกผู้เรียกว่าต้องทำอะไร
//  ตัวนี้เปลี่ยนให้เป็น 400 พร้อมบอกว่าขาด header อะไร
//
//  attribute นี้ไม่ได้ตรวจสิทธิ์ — TenantResolutionMiddleware ตรวจสมาชิกภาพ
//  ไปแล้วก่อนหน้า ที่นี่แค่ยืนยันว่ามี context จริง
//
//  ═════════════════════════════════════════════════════════════════════════
//  ⚠️ ห้าม resolve ITenantContext ผ่าน constructor หรือ IFilterFactory
//
//  เวอร์ชันแรกของไฟล์นี้ทำเป็น IFilterFactory ที่ IsReusable => true แล้ว
//  รับ ITenantContext เข้ามาทาง constructor ผลคือ MVC cache instance ของ
//  filter ไว้ "ข้าม request" พร้อมกับ ITenantContext ของ request แรกที่ยิงมา
//
//  อาการที่เจอ: request แรกที่ไม่ส่ง header ทำให้ทุก request หลังจากนั้นตอบ
//  400 ทั้งที่ส่ง header มาถูก — แต่อาการที่ "ไม่ได้เจอ" อันตรายกว่ามาก
//  ถ้าลำดับกลับกัน filter จะถือ context ของ workspace อื่นค้างไว้
//
//  ITenantContext เป็น scoped จึงต้องอ่านจาก HttpContext.RequestServices
//  ทุกครั้งเท่านั้น
//  ═════════════════════════════════════════════════════════════════════════
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequireWorkspaceAttribute : Attribute, IActionFilter
{
    public void OnActionExecuting(ActionExecutingContext context)
    {
        var tenant = context.HttpContext.RequestServices.GetRequiredService<ITenantContext>();

        if (tenant.WorkspaceId is not null) return;

        context.Result = new BadRequestObjectResult(
            ApiResponse<object>.Fail(
                $"ต้องระบุ workspace ผ่าน header {TenantResolutionMiddleware.WorkspaceHeader}",
                code: "workspace_required"));
    }

    public void OnActionExecuted(ActionExecutedContext context) { }
}
