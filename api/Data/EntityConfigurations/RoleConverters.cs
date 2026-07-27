using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using ProjectManagementAPI.Domain;

namespace ProjectManagementAPI.Data.EntityConfigurations;

// ═══════════════════════════════════════════════════════════════════════════
//  enum <-> text
//
//  เก็บเป็น text เพราะอ่าน SQL ดิบแล้วเข้าใจได้ และการแทรก enum member
//  ตรงกลางไม่เปลี่ยนความหมายของข้อมูลเดิม (ดู Domain/Roles.cs)
//
//  ค่าที่ใช้ต้องตรงกับ CHECK constraint ใน migration — ถ้าไม่ตรง INSERT จะพัง
//  ตอน runtime ไม่ใช่ตอน compile
// ═══════════════════════════════════════════════════════════════════════════
public static class RoleConverters
{
    private static ValueConverter<TEnum, string> Build<TEnum>(
        IReadOnlyDictionary<TEnum, string> names)
        where TEnum : struct, Enum
    {
        var reverse = names.ToDictionary(kv => kv.Value, kv => kv.Key, StringComparer.Ordinal);

        // expression tree ห้ามมี `out` และห้ามมี throw-expression จึงต้องแยก
        // การ parse ออกไปเป็น static method แล้วเรียกจากใน expression
        return new ValueConverter<TEnum, string>(
            value => names[value],
            text => Parse(text, reverse));
    }

    private static TEnum Parse<TEnum>(string text, Dictionary<string, TEnum> reverse)
        where TEnum : struct, Enum
        => reverse.TryGetValue(text, out var parsed)
            ? parsed
            : throw new InvalidOperationException(
                $"ค่า '{text}' ในคอลัมน์ไม่ตรงกับ {typeof(TEnum).Name} ใด ๆ — " +
                "ข้อมูลกับ enum ไม่ sync กัน ตรวจ CHECK constraint ใน migration");

    public static readonly ValueConverter<WorkspaceRole, string> WorkspaceRole =
        Build(RoleNames.Workspace);

    public static readonly ValueConverter<PageRole, string> PageRole =
        Build(RoleNames.Page);

    public static readonly ValueConverter<PageKind, string> PageKind =
        Build(RoleNames.Kind);

    public static readonly ValueConverter<AclSubjectType, string> AclSubjectType =
        Build(RoleNames.SubjectType);

    public static readonly ValueConverter<UserKind, string> UserKind =
        Build(RoleNames.Kinds);
}
