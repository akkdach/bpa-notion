namespace ProjectManagementAPI.Helpers;

// ═══════════════════════════════════════════════════════════════════════════
//  Result<T> — สำหรับ failure ที่ "คาดไว้แล้ว"
//
//  "page not found", "rank collision", "formula cycle detected" คือ outcome
//  ไม่ใช่ exception exception เก็บไว้ใช้กับบั๊กจริง ๆ เท่านั้น
//
//  เหตุผลที่ไม่ใช้ exception เป็น control flow:
//    1. อ่าน signature แล้วรู้เลยว่า method นี้ล้มเหลวได้แบบไหน
//    2. DocHub.PushUpdate ทำงานทุก keystroke — throw/catch ใน hot path
//       เป็นปัญหา performance จริง ไม่ใช่แค่เรื่องสไตล์
// ═══════════════════════════════════════════════════════════════════════════

/// <summary>ชนิดของความล้มเหลว — controller แปลงเป็น HTTP status ที่เดียว</summary>
public enum ErrorKind
{
    /// <summary>ไม่พบ — หรือมีแต่ผู้ใช้ไม่มีสิทธิ์เห็น (ตอบ 404 ทั้งสองกรณี)</summary>
    NotFound,

    /// <summary>input ไม่ถูกต้อง → 400</summary>
    Validation,

    /// <summary>ยังไม่ได้ login → 401</summary>
    Unauthorized,

    /// <summary>login แล้วแต่ไม่มีสิทธิ์ → 403</summary>
    Forbidden,

    /// <summary>ชนกับ state ปัจจุบัน เช่น slug ซ้ำ → 409</summary>
    Conflict,

    /// <summary>ระบบภายนอกล้ม → 503</summary>
    Unavailable
}

public readonly record struct Error(ErrorKind Kind, string Message, string? Code = null)
{
    public static Error NotFound(string message, string? code = null)
        => new(ErrorKind.NotFound, message, code);

    public static Error Validation(string message, string? code = null)
        => new(ErrorKind.Validation, message, code);

    public static Error Unauthorized(string message, string? code = null)
        => new(ErrorKind.Unauthorized, message, code);

    public static Error Forbidden(string message, string? code = null)
        => new(ErrorKind.Forbidden, message, code);

    public static Error Conflict(string message, string? code = null)
        => new(ErrorKind.Conflict, message, code);

    public static Error Unavailable(string message, string? code = null)
        => new(ErrorKind.Unavailable, message, code);
}

/// <summary>ผลลัพธ์ที่มีค่ากลับ</summary>
public readonly struct Result<T>
{
    private readonly T? _value;

    private Result(T value)
    {
        _value = value;
        Error = default;
        IsSuccess = true;
    }

    private Result(Error error)
    {
        _value = default;
        Error = error;
        IsSuccess = false;
    }

    public bool IsSuccess { get; }
    public bool IsFailure => !IsSuccess;
    public Error Error { get; }

    /// <summary>อ่านค่าได้เมื่อ IsSuccess เท่านั้น</summary>
    public T Value => IsSuccess
        ? _value!
        : throw new InvalidOperationException(
            $"อ่าน Value จาก Result ที่ล้มเหลวไม่ได้ ({Error.Kind}: {Error.Message})");

    public static Result<T> Success(T value) => new(value);
    public static Result<T> Failure(Error error) => new(error);

    // ทำให้เขียน `return someValue;` และ `return Error.NotFound(...)` ได้ตรง ๆ
    public static implicit operator Result<T>(T value) => new(value);
    public static implicit operator Result<T>(Error error) => new(error);
}

/// <summary>ผลลัพธ์ที่ไม่มีค่ากลับ (command)</summary>
public readonly struct Result
{
    private Result(Error error)
    {
        Error = error;
        IsSuccess = false;
    }

    private Result(bool success)
    {
        Error = default;
        IsSuccess = success;
    }

    public bool IsSuccess { get; }
    public bool IsFailure => !IsSuccess;
    public Error Error { get; }

    public static Result Success() => new(true);
    public static Result Failure(Error error) => new(error);

    public static implicit operator Result(Error error) => new(error);
}
