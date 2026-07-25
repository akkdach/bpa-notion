using FluentValidation;
using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Services;

namespace ProjectManagementAPI.Validators;

public class CreateWorkspaceRequestValidator : AbstractValidator<CreateWorkspaceRequest>
{
    public CreateWorkspaceRequestValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("กรุณากรอกชื่อ workspace")
            .MaximumLength(200).WithMessage("ชื่อยาวเกินไป");

        // slug ระบุเองได้แต่ไม่บังคับ — ถ้าไม่ระบุ ระบบสร้างให้จากชื่อ
        // ตรวจแค่ความยาวที่นี่ ส่วนรูปแบบให้ SlugGenerator.TryNormalize จัดการ
        // เพื่อไม่ให้กติกาอยู่สองที่แล้วเพี้ยนกัน
        RuleFor(x => x.Slug)
            .MaximumLength(SlugGenerator.MaxLength)
            .WithMessage($"slug ยาวเกิน {SlugGenerator.MaxLength} ตัวอักษร")
            .When(x => !string.IsNullOrWhiteSpace(x.Slug));

        RuleFor(x => x.Icon).MaximumLength(200).WithMessage("icon ยาวเกินไป");
    }
}

public class UpdateWorkspaceRequestValidator : AbstractValidator<UpdateWorkspaceRequest>
{
    public UpdateWorkspaceRequestValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("กรุณากรอกชื่อ workspace")
            .MaximumLength(200).WithMessage("ชื่อยาวเกินไป");

        RuleFor(x => x.Icon).MaximumLength(200).WithMessage("icon ยาวเกินไป");
    }
}

public class AddMemberRequestValidator : AbstractValidator<AddMemberRequest>
{
    public AddMemberRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("กรุณากรอกอีเมล")
            .MaximumLength(320).WithMessage("อีเมลยาวเกินไป");

        RuleFor(x => x.Role).NotEmpty().WithMessage("กรุณาระบุสิทธิ์");
    }
}

public class UpdateMemberRoleRequestValidator : AbstractValidator<UpdateMemberRoleRequest>
{
    public UpdateMemberRoleRequestValidator()
    {
        RuleFor(x => x.Role).NotEmpty().WithMessage("กรุณาระบุสิทธิ์");
    }
}
