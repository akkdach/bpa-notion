namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  Fractional indexing
//
//  พอร์ตของ npm `fractional-indexing` (base62) ให้ฝั่งเซิร์ฟเวอร์สร้าง rank ได้
//  ตรงกับที่ฝั่ง client สร้าง — ทั้งสองฝั่งต้องให้ผลเหมือนกันเป๊ะ ไม่งั้นลำดับ
//  ที่ client เห็นกับที่ฐานข้อมูลเก็บจะไม่ตรงกัน
//
//  ทำไมต้องใช้ fractional index แทน order แบบตัวเลข:
//  แทรกหน้าใหม่ระหว่างสองหน้า = เขียนแถวเดียว ไม่ต้อง renumber พี่น้องทั้งหมด
//  (ซึ่งบนหน้าที่มีลูก 200 หน้า คือ 200 UPDATE และเป็นจุดที่ transaction ชนกัน)
//
//  ═════════════════════════════════════════════════════════════════════════
//  ⚠️ อัลกอริทึมนี้ตั้งอยู่บน "byte order" ทั้งหมด
//
//  คอลัมน์ rank จึงต้องเป็น COLLATE "C" (ดู PageConfigurations.cs) และการ
//  เทียบสตริงในโค้ดต้องใช้ StringComparison.Ordinal เท่านั้น ห้ามใช้ตัวเทียบ
//  ที่อิง culture เพราะ base62 มีทั้ง A-Z และ a-z ซึ่ง ICU เรียงสลับกัน
//  (a A b B) ต่างจาก byte order (A B a b)
//  ═════════════════════════════════════════════════════════════════════════
//
//  ⚠️ rank ชนกันได้ตามปกติ — สอง client แทรกระหว่างคู่เดียวกันพร้อมกันจะได้
//     ค่าเท่ากัน จึงต้อง ORDER BY rank, id เสมอ (id เป็นตัวตัดสินที่ทุก client
//     เห็นตรงกัน) และห้ามทำ unique index บน (parent_id, rank)
// ═══════════════════════════════════════════════════════════════════════════
public static class FractionalIndex
{
    private const string Digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    /// <summary>rank แรกสุดเมื่อยังไม่มีพี่น้องเลย</summary>
    public const string First = "a0";

    /// <summary>
    /// สร้าง rank ที่อยู่ระหว่าง a และ b
    /// a = null แปลว่าแทรกไว้หน้าสุด, b = null แปลว่าแทรกไว้ท้ายสุด
    /// </summary>
    /// <exception cref="ArgumentException">a >= b หรือ key ผิดรูป</exception>
    public static string Between(string? a, string? b)
    {
        if (a is not null) ValidateOrderKey(a);
        if (b is not null) ValidateOrderKey(b);

        if (a is not null && b is not null && string.CompareOrdinal(a, b) >= 0)
        {
            throw new ArgumentException($"rank ต้องเรียงจากน้อยไปมาก แต่ได้ '{a}' >= '{b}'");
        }

        if (a is null)
        {
            if (b is null) return First;

            var integerB = IntegerPart(b);
            var fractionB = b[integerB.Length..];

            if (integerB == "A" + new string(Digits[0], 26))
            {
                return integerB + Midpoint(string.Empty, fractionB);
            }

            if (string.CompareOrdinal(integerB, b) < 0) return integerB;

            return DecrementInteger(integerB)
                ?? throw new ArgumentException("ลด rank ต่ำกว่านี้ไม่ได้แล้ว");
        }

        if (b is null)
        {
            var integerA = IntegerPart(a);
            var fractionA = a[integerA.Length..];
            var incremented = IncrementInteger(integerA);

            return incremented ?? integerA + Midpoint(fractionA, null);
        }

        var ia = IntegerPart(a);
        var fa = a[ia.Length..];
        var ib = IntegerPart(b);
        var fb = b[ib.Length..];

        if (ia == ib) return ia + Midpoint(fa, fb);

        var next = IncrementInteger(ia)
            ?? throw new ArgumentException("เพิ่ม rank สูงกว่านี้ไม่ได้แล้ว");

        return string.CompareOrdinal(next, b) < 0 ? next : ia + Midpoint(fa, null);
    }

    /// <summary>
    /// สร้าง rank ต่อเนื่อง n ตัวระหว่าง a และ b
    /// ใช้ตอนสร้างหลายหน้าพร้อมกัน (duplicate subtree, import)
    /// </summary>
    public static List<string> BetweenMany(string? a, string? b, int count)
    {
        if (count <= 0) return [];

        var result = new List<string>(count);

        if (b is null)
        {
            var previous = a;
            for (var i = 0; i < count; i++)
            {
                previous = Between(previous, null);
                result.Add(previous);
            }
            return result;
        }

        if (a is null)
        {
            // สร้างถอยหลังจาก b เพื่อให้ระยะห่างสม่ำเสมอ แล้วค่อยกลับด้าน
            var next = b;
            for (var i = 0; i < count; i++)
            {
                next = Between(null, next);
                result.Add(next);
            }
            result.Reverse();
            return result;
        }

        // แบ่งครึ่งแบบ binary เพื่อไม่ให้สตริงยาวเร็วเกินไป
        var mid = count / 2;
        var middle = Between(a, b);

        result.AddRange(BetweenMany(a, middle, mid));
        result.Add(middle);
        result.AddRange(BetweenMany(middle, b, count - mid - 1));

        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ภายใน
    // ═══════════════════════════════════════════════════════════════════════

    /// <summary>
    /// ตัวอักษรตัวแรกบอกความยาวของ "ส่วนจำนวนเต็ม"
    /// a..z = ความยาว 2..27 (ค่าบวก), Z..A = ความยาว 2..27 (ค่าลบ)
    /// </summary>
    private static int IntegerLength(char head) => head switch
    {
        >= 'a' and <= 'z' => head - 'a' + 2,
        >= 'A' and <= 'Z' => 'Z' - head + 2,
        _ => throw new ArgumentException($"หัวของ rank ไม่ถูกต้อง: '{head}'")
    };

    private static string IntegerPart(string key)
    {
        if (key.Length == 0) throw new ArgumentException("rank ว่าง");

        var length = IntegerLength(key[0]);
        if (length > key.Length) throw new ArgumentException($"rank สั้นเกินไป: '{key}'");

        return key[..length];
    }

    private static void ValidateOrderKey(string key)
    {
        // ค่าต่ำสุดสงวนไว้ ห้ามใช้ ไม่งั้นจะแทรกข้างหน้าไม่ได้อีก
        if (key == "A" + new string(Digits[0], 26))
        {
            throw new ArgumentException($"rank ต่ำสุดที่สงวนไว้: '{key}'");
        }

        var integer = IntegerPart(key);
        var fraction = key[integer.Length..];

        // เลขศูนย์ท้ายสุดทำให้ค่าไม่ unique ('a01' กับ 'a010' คือค่าเดียวกัน)
        if (fraction.Length > 0 && fraction[^1] == Digits[0])
        {
            throw new ArgumentException($"rank ลงท้ายด้วยศูนย์: '{key}'");
        }
    }

    private static void ValidateInteger(string integer)
    {
        if (integer.Length != IntegerLength(integer[0]))
        {
            throw new ArgumentException($"ส่วนจำนวนเต็มยาวไม่ถูกต้อง: '{integer}'");
        }
    }

    private static string? IncrementInteger(string x)
    {
        ValidateInteger(x);

        var head = x[0];
        var digits = x[1..].ToCharArray();
        var carry = true;

        for (var i = digits.Length - 1; carry && i >= 0; i--)
        {
            var d = Digits.IndexOf(digits[i], StringComparison.Ordinal) + 1;
            if (d == Digits.Length)
            {
                digits[i] = Digits[0];
            }
            else
            {
                digits[i] = Digits[d];
                carry = false;
            }
        }

        if (!carry) return head + new string(digits);

        // ทดล้น — ต้องขยายความยาวของส่วนจำนวนเต็ม
        if (head == 'Z') return "a" + Digits[0];
        if (head == 'z') return null;   // เต็มเพดานแล้ว

        var nextHead = (char)(head + 1);
        var list = digits.ToList();

        if (nextHead > 'a') list.Add(Digits[0]); else list.RemoveAt(list.Count - 1);

        return nextHead + new string([.. list]);
    }

    private static string? DecrementInteger(string x)
    {
        ValidateInteger(x);

        var head = x[0];
        var digits = x[1..].ToCharArray();
        var borrow = true;

        for (var i = digits.Length - 1; borrow && i >= 0; i--)
        {
            var d = Digits.IndexOf(digits[i], StringComparison.Ordinal) - 1;
            if (d == -1)
            {
                digits[i] = Digits[^1];
            }
            else
            {
                digits[i] = Digits[d];
                borrow = false;
            }
        }

        if (!borrow) return head + new string(digits);

        if (head == 'a') return "Z" + Digits[^1];
        if (head == 'A') return null;   // ถึงพื้นแล้ว

        var prevHead = (char)(head - 1);
        var list = digits.ToList();

        if (prevHead < 'Z') list.Add(Digits[^1]); else list.RemoveAt(list.Count - 1);

        return prevHead + new string([.. list]);
    }

    /// <summary>ค่ากึ่งกลางของส่วนทศนิยม (a &lt; b เสมอ, b = null คือไม่มีขอบบน)</summary>
    private static string Midpoint(string a, string? b)
    {
        if (b is not null && string.CompareOrdinal(a, b) >= 0)
        {
            throw new ArgumentException($"'{a}' >= '{b}'");
        }

        if (a.Length > 0 && a[^1] == Digits[0] ||
            b is { Length: > 0 } && b[^1] == Digits[0])
        {
            throw new ArgumentException("ส่วนทศนิยมลงท้ายด้วยศูนย์");
        }

        if (b is not null)
        {
            // ตัดส่วนหน้าที่เหมือนกันออกก่อน
            var n = 0;
            while (n < b.Length && (n < a.Length ? a[n] : Digits[0]) == b[n]) n++;

            if (n > 0) return b[..n] + Midpoint(n < a.Length ? a[n..] : string.Empty, b[n..]);
        }

        var digitA = a.Length > 0 ? Digits.IndexOf(a[0], StringComparison.Ordinal) : 0;
        var digitB = b is not null ? Digits.IndexOf(b[0], StringComparison.Ordinal) : Digits.Length;

        if (digitB - digitA > 1)
        {
            return Digits[(int)Math.Round(0.5 * (digitA + digitB), MidpointRounding.AwayFromZero)]
                .ToString();
        }

        // เลขตัวแรกติดกัน — ต้องลงไปหลักถัดไป
        if (b is { Length: > 1 }) return b[..1];

        return Digits[digitA] + Midpoint(a.Length > 0 ? a[1..] : string.Empty, null);
    }
}
