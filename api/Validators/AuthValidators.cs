using FluentValidation;
using ProjectManagementAPI.DTOs;

namespace ProjectManagementAPI.Validators;

// ═══════════════════════════════════════════════════════════════════════════
//  validation อยู่ที่นี่ที่เดียว ไม่กระจายอยู่ใน controller
//  ทำงานผ่าน Filters/ValidationFilter.cs
// ═══════════════════════════════════════════════════════════════════════════

public class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("กรุณากรอกอีเมล")
            .EmailAddress().WithMessage("รูปแบบอีเมลไม่ถูกต้อง")
            .MaximumLength(320).WithMessage("อีเมลยาวเกินไป");

        // ─────────────────────────────────────────────────────────────────
        //  ความยาวขั้นต่ำ 12 ตัว และไม่บังคับ "ต้องมีตัวพิมพ์ใหญ่/อักขระพิเศษ"
        //
        //  กฎ composition แบบนั้นดันให้คนตั้งรหัสแบบ Password1! ซึ่งเดาง่ายกว่า
        //  passphrase ยาว ๆ และ NIST เลิกแนะนำไปแล้ว ความยาวคือสิ่งที่ได้ผลจริง
        //
        //  ⚠️ ไทยกินไบต์ละ 3 — วัดเป็นจำนวนตัวอักษร ไม่ใช่ไบต์ และ bcrypt
        //     รองรับได้เพราะเราใช้ EnhancedHashPassword (pre-hash ด้วย SHA-384)
        // ─────────────────────────────────────────────────────────────────
        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("กรุณากรอกรหัสผ่าน")
            .MinimumLength(12).WithMessage("รหัสผ่านต้องยาวอย่างน้อย 12 ตัวอักษร")
            .MaximumLength(200).WithMessage("รหัสผ่านยาวเกินไป");

        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("กรุณากรอกชื่อ")
            .MaximumLength(200).WithMessage("ชื่อยาวเกินไป");
    }
}

public class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        // login ไม่ตรวจรูปแบบ/ความยาวรหัสผ่าน — ตรวจแล้วจะบอกใบ้เกณฑ์ที่ใช้
        // ตอนสมัคร และผู้ใช้เก่าที่ตั้งรหัสไว้ก่อนเปลี่ยนกฎจะ login ไม่ได้
        RuleFor(x => x.Email).NotEmpty().WithMessage("กรุณากรอกอีเมล");
        RuleFor(x => x.Password).NotEmpty().WithMessage("กรุณากรอกรหัสผ่าน");
    }
}

public class RefreshRequestValidator : AbstractValidator<RefreshRequest>
{
    public RefreshRequestValidator()
    {
        RuleFor(x => x.RefreshToken).NotEmpty().WithMessage("ไม่มี refresh token");
    }
}
