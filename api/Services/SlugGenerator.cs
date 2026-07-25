using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  Slug
//
//  ⚠️ ชื่อ workspace ส่วนใหญ่จะเป็นภาษาไทย ซึ่งแปลงเป็น slug แบบ ASCII ไม่ได้
//     ตรง ๆ วิธีที่มักเห็น (ถอดเสียงเป็นอักษรโรมัน) ต้องพึ่งตารางถอดเสียงที่
//     ไม่มีมาตรฐานเดียว และให้ผลที่คนไทยอ่านแล้วงงกว่าเดิม
//
//     ที่นี่จึงทำง่าย ๆ: เก็บส่วนที่เป็น ASCII ไว้ ถ้าไม่เหลืออะไรเลยก็ใช้
//     ตัวสุ่ม ชื่อจริงอยู่ในคอลัมน์ name อยู่แล้ว slug เป็นแค่ตัวระบุใน URL
//
//  ต้องผ่าน CHECK constraint: ^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$
//  แปลว่า 3–60 ตัว ขึ้นและลงท้ายด้วยตัวอักษร/ตัวเลข
// ═══════════════════════════════════════════════════════════════════════════
public static class SlugGenerator
{
    public const int MinLength = 3;
    public const int MaxLength = 60;

    /// <summary>ตัวอักษรที่อ่านไม่สับสน — ตัด 0/o/1/l/i ออก</summary>
    private const string RandomAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";

    public static string FromName(string name)
    {
        var slug = Slugify(name);

        // ชื่อไทยล้วนจะเหลือสตริงว่าง — ใช้คำนำหน้าที่อ่านออกแทน
        return slug.Length >= MinLength ? slug : $"ws-{RandomSuffix(8)}";
    }

    /// <summary>ทำให้ข้อความที่ผู้ใช้พิมพ์เองเป็น slug ที่ถูกกติกา คืน null ถ้าใช้ไม่ได้</summary>
    public static string? TryNormalize(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return null;

        var slug = Slugify(candidate);
        return slug.Length >= MinLength ? slug : null;
    }

    /// <summary>เติมท้ายเมื่อ slug ชนกัน — ต่อท้ายไม่ทับของเดิมเพื่อให้ยังพอเดาที่มาได้</summary>
    public static string WithSuffix(string slug, int suffixLength = 5)
    {
        var suffix = $"-{RandomSuffix(suffixLength)}";
        var room = MaxLength - suffix.Length;

        var head = slug.Length <= room ? slug : slug[..room];
        return $"{head.TrimEnd('-')}{suffix}";
    }

    private static string Slugify(string input)
    {
        // แยกวรรณยุกต์/เครื่องหมายออกจากตัวอักษรฐาน แล้วตัดทิ้ง
        // (จัดการภาษาที่ใช้อักษรโรมันมีเครื่องหมาย เช่น café → cafe)
        var normalized = input.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);
        var lastWasDash = false;

        foreach (var ch in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (ch is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                builder.Append(ch);
                lastWasDash = false;
            }
            else if (ch is >= 'A' and <= 'Z')
            {
                builder.Append(char.ToLowerInvariant(ch));
                lastWasDash = false;
            }
            else if (!lastWasDash && builder.Length > 0)
            {
                // อักขระอื่น (รวมภาษาไทย) กลายเป็นขีดเดียว ไม่ซ้อนกัน
                builder.Append('-');
                lastWasDash = true;
            }
        }

        var slug = builder.ToString().Trim('-');
        return slug.Length <= MaxLength ? slug : slug[..MaxLength].TrimEnd('-');
    }

    private static string RandomSuffix(int length)
    {
        var chars = new char[length];
        for (var i = 0; i < length; i++)
        {
            chars[i] = RandomAlphabet[RandomNumberGenerator.GetInt32(RandomAlphabet.Length)];
        }
        return new string(chars);
    }
}
