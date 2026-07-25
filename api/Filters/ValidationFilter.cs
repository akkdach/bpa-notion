using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using ProjectManagementAPI.Helpers;

namespace ProjectManagementAPI.Filters;

// ═══════════════════════════════════════════════════════════════════════════
//  ValidationFilter
//
//  หา IValidator<T> ของ argument แต่ละตัวจาก DI แล้วรันก่อนเข้า action
//  controller จึงไม่ต้องมี `if (!ModelState.IsValid)` ซ้ำ ๆ ทุกตัว
//
//  ⚠️ ใช้ FluentValidation.DependencyInjectionExtensions (ไม่ใช่
//     FluentValidation.AspNetCore ที่ค้างอยู่ที่ 11.x) — maintainer เลิกแนะนำ
//     auto-validation integration ของแพ็กเกจนั้นแล้ว การเรียกจาก filter เอง
//     ทำให้เห็นชัดว่า validation เกิดขึ้นตอนไหนและ error หน้าตาเป็นอย่างไร
// ═══════════════════════════════════════════════════════════════════════════
public class ValidationFilter(IServiceProvider services) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(
        ActionExecutingContext context, ActionExecutionDelegate next)
    {
        // ─────────────────────────────────────────────────────────────────
        //  parameter ที่ควรมาจาก body แต่เป็น null = body ว่างหรือ deserialize
        //  ไม่ผ่าน
        //
        //  เราปิด SuppressModelStateInvalidFilter ไว้ (เพื่อให้ error หน้าตา
        //  เหมือน endpoint อื่น) ผลข้างเคียงคือ action ยังถูกเรียกด้วย null
        //  แล้วไปพังเป็น NullReferenceException → 500 ซึ่งไม่ได้บอกอะไรเลย
        //  ตรวจที่นี่แล้วตอบ 400 พร้อมเหตุผลจริง
        // ─────────────────────────────────────────────────────────────────
        foreach (var (name, descriptor) in DescribeBodyParameters(context))
        {
            // ⚠️ ต้องถือว่า "ไม่มี key" เป็นความล้มเหลวด้วย ไม่ใช่แค่ "ค่าเป็น null"
            //    เมื่อ model binding อ่าน body ไม่ได้ ASP.NET Core จะไม่ใส่ key
            //    ลงใน ActionArguments เลย ถ้าเช็คแค่ค่า null จะปล่อยผ่านแล้วไป
            //    พังเป็น NullReferenceException → 500 (เจอมาแล้วตอน Stage B)
            var bound = context.ActionArguments.TryGetValue(name, out var value);

            if (bound && value is not null) continue;

            var detail = context.ModelState.Values
                .SelectMany(entry => entry.Errors)
                .Select(error => error.ErrorMessage)
                .FirstOrDefault(message => !string.IsNullOrWhiteSpace(message));

            context.Result = new BadRequestObjectResult(
                ApiResponse<object>.Fail(
                    detail ?? $"อ่านข้อมูลใน request body ไม่ได้ (ต้องเป็น JSON ของ {descriptor.Name})",
                    code: "invalid_body"));
            return;
        }

        foreach (var argument in context.ActionArguments.Values)
        {
            if (argument is null) continue;

            var validatorType = typeof(IValidator<>).MakeGenericType(argument.GetType());

            if (services.GetService(validatorType) is not IValidator validator) continue;

            var validationContext = new ValidationContext<object>(argument);
            var result = await validator.ValidateAsync(validationContext, context.HttpContext.RequestAborted);

            if (result.IsValid) continue;

            // รวมข้อความของ field เดียวกันเข้าด้วยกัน เพื่อให้ฝั่ง client แสดง
            // ใต้ input ที่ถูกต้องได้
            var errors = result.Errors
                .GroupBy(e => ToCamelCase(e.PropertyName))
                .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray());

            context.Result = new BadRequestObjectResult(
                ApiResponse<object>.Fail(
                    result.Errors[0].ErrorMessage,
                    code: "validation_failed") with
                {
                    Data = new { errors }
                });

            return;
        }

        await next();
    }

    /// <summary>
    /// parameter ที่เป็น reference type และไม่ nullable — พวกนี้คือ body parameter
    /// (CancellationToken, primitive, และ nullable ไม่นับ)
    /// </summary>
    private static IEnumerable<(string Name, Microsoft.AspNetCore.Mvc.Abstractions.ParameterDescriptor Descriptor)>
        DescribeBodyParameters(ActionExecutingContext context)
    {
        foreach (var parameter in context.ActionDescriptor.Parameters)
        {
            var type = parameter.ParameterType;

            if (type == typeof(CancellationToken)) continue;
            if (type.IsValueType) continue;
            if (type == typeof(string)) continue;

            yield return (parameter.Name, parameter);
        }
    }

    /// <summary>ชื่อ field ต้องเป็น camelCase ให้ตรงกับ JSON ที่ client ส่งมา</summary>
    private static string ToCamelCase(string name)
        => string.IsNullOrEmpty(name) || char.IsLower(name[0])
            ? name
            : char.ToLowerInvariant(name[0]) + name[1..];
}
