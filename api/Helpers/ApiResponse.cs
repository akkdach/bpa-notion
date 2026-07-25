using Microsoft.AspNetCore.Mvc;

namespace ProjectManagementAPI.Helpers;

// ═══════════════════════════════════════════════════════════════════════════
//  ApiResponse — envelope เดียวกันทุก endpoint
// ═══════════════════════════════════════════════════════════════════════════
public record ApiResponse<T>
{
    public bool Success { get; init; }
    public T? Data { get; init; }
    public string? Message { get; init; }
    public string? Code { get; init; }

    public static ApiResponse<T> Ok(T data, string? message = null)
        => new() { Success = true, Data = data, Message = message };

    public static ApiResponse<T> Fail(string message, string? code = null)
        => new() { Success = false, Message = message, Code = code };
}

/// <summary>envelope สำหรับ endpoint ที่ไม่มี data กลับ</summary>
public record ApiResponse : ApiResponse<object>
{
    public static ApiResponse Ok(string? message = null)
        => new() { Success = true, Message = message };
}

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize)
{
    public bool HasMore => Page * PageSize < Total;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Result → HTTP mapping — "ที่เดียว" ตามที่ PLAN.md กำหนด
//
//  controller ไม่ต้องรู้ว่า ErrorKind ไหนแปลงเป็น status อะไร แค่เรียก
//  ToActionResult() ทำให้ status code ทั้งระบบสอดคล้องกันโดยไม่ต้องพึ่งวินัย
//
//  ⚠️ NotFound และ Forbidden ที่เกิดจาก "ไม่มีสิทธิ์เห็น" ต้องตอบ 404 ทั้งคู่
//     403 บอกผู้ใช้ว่า resource นี้มีอยู่จริง = leak การมีอยู่ข้าม tenant
// ═══════════════════════════════════════════════════════════════════════════
public static class ResultExtensions
{
    public static IActionResult ToActionResult<T>(this Result<T> result)
        => result.IsSuccess
            ? new OkObjectResult(ApiResponse<T>.Ok(result.Value))
            : ToErrorResult(result.Error);

    public static IActionResult ToActionResult(this Result result)
        => result.IsSuccess
            ? new OkObjectResult(ApiResponse.Ok())
            : ToErrorResult(result.Error);

    public static IActionResult ToCreatedResult<T>(this Result<T> result, string location)
        => result.IsSuccess
            ? new CreatedResult(location, ApiResponse<T>.Ok(result.Value))
            : ToErrorResult(result.Error);

    private static IActionResult ToErrorResult(Error error)
    {
        var statusCode = error.Kind switch
        {
            ErrorKind.NotFound => StatusCodes.Status404NotFound,
            ErrorKind.Validation => StatusCodes.Status400BadRequest,
            ErrorKind.Unauthorized => StatusCodes.Status401Unauthorized,
            ErrorKind.Forbidden => StatusCodes.Status403Forbidden,
            ErrorKind.Conflict => StatusCodes.Status409Conflict,
            ErrorKind.Unavailable => StatusCodes.Status503ServiceUnavailable,
            _ => StatusCodes.Status500InternalServerError
        };

        return new ObjectResult(ApiResponse<object>.Fail(error.Message, error.Code))
        {
            StatusCode = statusCode
        };
    }
}
