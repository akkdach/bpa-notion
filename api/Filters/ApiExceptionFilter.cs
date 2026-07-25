using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using ProjectManagementAPI.Helpers;

namespace ProjectManagementAPI.Filters;

// ═══════════════════════════════════════════════════════════════════════════
//  ApiExceptionFilter
//
//  exception ที่มาถึงที่นี่ = บั๊ก ไม่ใช่ failure ที่คาดไว้
//  (failure ที่คาดไว้ให้ return Result<T> — ดู Helpers/Result.cs)
//
//  หน้าที่: log ให้ครบ แล้วตอบ envelope เดียวกับ endpoint อื่น โดย
//  ไม่หลุด stack trace หรือ SQL ออกไปข้างนอกตอน production
// ═══════════════════════════════════════════════════════════════════════════
public class ApiExceptionFilter(
    ILogger<ApiExceptionFilter> logger,
    IHostEnvironment environment) : IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        var traceId = context.HttpContext.TraceIdentifier;

        logger.LogError(
            context.Exception,
            "Unhandled exception on {Method} {Path} (traceId={TraceId})",
            context.HttpContext.Request.Method,
            context.HttpContext.Request.Path,
            traceId);

        // dev: ส่งข้อความจริงกลับไปเพื่อ debug
        // prod: ส่งแค่ traceId ให้ผู้ใช้แจ้ง แล้วไปหาใน log
        var message = environment.IsDevelopment()
            ? context.Exception.Message
            : $"เกิดข้อผิดพลาดภายในระบบ (traceId: {traceId})";

        context.Result = new ObjectResult(
            ApiResponse<object>.Fail(message, code: "internal_error"))
        {
            StatusCode = StatusCodes.Status500InternalServerError
        };

        context.ExceptionHandled = true;
    }
}
