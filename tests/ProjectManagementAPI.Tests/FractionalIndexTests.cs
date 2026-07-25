using System.Text.Json;
using ProjectManagementAPI.Services;

namespace ProjectManagementAPI.Tests;

// ═══════════════════════════════════════════════════════════════════════════
//  FractionalIndex ต้องให้ผล "เหมือนเป๊ะ" กับ npm fractional-indexing
//
//  ทำไมถึงสำคัญขนาดนั้น: ฝั่ง client สร้าง rank ตอนลากสลับหน้า ส่วนฝั่ง
//  เซิร์ฟเวอร์สร้างตอนสร้างหน้าใหม่/ทำสำเนา ถ้าสองฝั่งคำนวณต่างกันแม้แต่
//  เคสเดียว ลำดับที่ผู้ใช้เห็นกับที่เก็บในฐานจะเริ่มไม่ตรงกัน และอาการจะโผล่
//  แบบสุ่ม ๆ หลังใช้งานไปพักหนึ่ง
//
//  fixture สร้างจากไลบรารีตัวจริง ไม่ใช่เขียนคาดเดาเอาเอง:
//    cd web && node -e "import('fractional-indexing').then(…)"
// ═══════════════════════════════════════════════════════════════════════════
public class FractionalIndexTests
{
    private record FixtureCase(string? A, string? B, string? Expected);

    private static readonly FixtureCase[] Cases = LoadFixture();

    private static FixtureCase[] LoadFixture()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "fractional-index-fixture.json");

        return JsonSerializer.Deserialize<FixtureCase[]>(
            File.ReadAllText(path),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("อ่าน fixture ไม่ได้");
    }


    /// <summary>
    /// เทียบทุกเคสในรอบเดียว
    ///
    /// ไม่ทำเป็น [Theory] ต่อเคส เพราะ fixture มี ~4,700 เคส ซึ่งจะกลายเป็น
    /// test case 4,700 ตัวใน runner แล้วรายงานช้าโดยไม่ได้ข้อมูลเพิ่ม
    /// ตรงนี้รวบไว้แล้วรายงานเฉพาะเคสที่ต่างพร้อมบริบท
    /// </summary>
    [Fact]
    public void Between_MatchesJavaScriptReference()
    {
        var mismatches = new List<string>();

        foreach (var (testCase, index) in Cases.Select((c, i) => (c, i)))
        {
            string actual;
            try
            {
                actual = FractionalIndex.Between(testCase.A, testCase.B);
            }
            catch (ArgumentException ex)
            {
                mismatches.Add($"[{index}] ({Show(testCase.A)}, {Show(testCase.B)}) " +
                               $"JS='{testCase.Expected}' แต่เราโยน {ex.Message}");
                continue;
            }

            if (actual != testCase.Expected)
            {
                mismatches.Add($"[{index}] ({Show(testCase.A)}, {Show(testCase.B)}) " +
                               $"JS='{testCase.Expected}' เรา='{actual}'");
            }
        }

        Assert.True(mismatches.Count == 0,
            $"ต่างจาก JS {mismatches.Count}/{Cases.Length} เคส:\n" +
            string.Join("\n", mismatches.Take(15)));
    }

    private static string Show(string? value) => value is null ? "null" : $"'{value}'";

    [Fact]
    public void Fixture_CoversTheHardCases()
    {
        // กันกรณี fixture หายหรือ copy ไม่ไป แล้วเทสผ่านเพราะไม่มีอะไรให้รัน
        Assert.True(Cases.Length > 4000, $"fixture มีแค่ {Cases.Length} เคส");

        // ต้องมีเคสที่ส่วนจำนวนเต็ม "ล้น" จนต้องขยายความยาว (หัวเปลี่ยนจาก a)
        var heads = Cases.Select(c => c.Expected![0]).Distinct().ToList();
        Assert.Contains('b', heads);   // ต่อท้ายจนล้นขึ้นความยาวถัดไป
        Assert.Contains('Z', heads);   // แทรกหน้าสุดจนยืมลงฝั่งค่าลบ
        Assert.Contains('Y', heads);

        // ต้องมีเคสที่ส่วนทศนิยมยาวมาก (แทรกกลางซ้ำ ๆ)
        Assert.True(Cases.Max(c => c.Expected!.Length) > 30);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ความต่างที่ "ตั้งใจ" ให้ต่างจาก JS
    // ═══════════════════════════════════════════════════════════════════════

    /// <summary>
    /// fractional-indexing v4 เปลี่ยนมา "สลับ a กับ b ให้เอง" เมื่อลำดับกลับกัน
    /// (generateKeyBetween('a1','a0') คืน 'a0V' ไม่ throw)
    ///
    /// ฝั่งเซิร์ฟเวอร์เราเลือกให้ throw แทน โดยเจตนา:
    ///
    /// เซิร์ฟเวอร์เรียก Between() ด้วยค่า rank ที่อ่านมาจากฐานข้อมูล ถ้าลำดับ
    /// กลับกันแปลว่า query เรียงผิด หรือ collation ของคอลัมน์ไม่ใช่ "C" ซึ่ง
    /// เป็นบั๊กที่ต้องรู้ทันที การสลับให้เงียบ ๆ จะได้ค่าที่ "ใช้ได้" แต่ปิดบัง
    /// ต้นเหตุไว้จนกว่าลำดับหน้าจะเพี้ยนให้ผู้ใช้เห็น
    ///
    /// ฝั่ง client ยังใช้ไลบรารีตัวจริงตามปกติ ความต่างนี้จะมีผลก็ต่อเมื่อ
    /// client ส่งค่าที่กลับลำดับมา ซึ่งเป็นบั๊กของ client อยู่แล้ว
    /// </summary>
    [Fact]
    public void Between_ThrowsOnSwappedInput_UnlikeJavaScript()
    {
        var ex = Assert.Throws<ArgumentException>(() => FractionalIndex.Between("a1", "a0"));
        Assert.Contains("a1", ex.Message);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  คุณสมบัติที่ต้องเป็นจริงเสมอ
    // ═══════════════════════════════════════════════════════════════════════

    [Fact]
    public void Between_ResultAlwaysSortsBetweenItsNeighbours()
    {
        var a = FractionalIndex.First;
        var b = FractionalIndex.Between(a, null);

        for (var i = 0; i < 200; i++)
        {
            var mid = FractionalIndex.Between(a, b);

            // ⚠️ ต้องเทียบแบบ ordinal เท่านั้น — ตรงกับ COLLATE "C" ของคอลัมน์ rank
            Assert.True(string.CompareOrdinal(a, mid) < 0, $"'{a}' ต้องน้อยกว่า '{mid}'");
            Assert.True(string.CompareOrdinal(mid, b) < 0, $"'{mid}' ต้องน้อยกว่า '{b}'");

            a = mid;
        }
    }

    [Fact]
    public void Between_AppendingStaysSortedForLongSequences()
    {
        var keys = new List<string>();
        string? previous = null;

        // 500 หน้าในโฟลเดอร์เดียวเป็นเรื่องปกติ
        for (var i = 0; i < 500; i++)
        {
            previous = FractionalIndex.Between(previous, null);
            keys.Add(previous);
        }

        var sorted = keys.Order(StringComparer.Ordinal).ToList();
        Assert.Equal(sorted, keys);

        // ต่อท้ายเรื่อย ๆ ต้องไม่ทำให้สตริงยาวขึ้นเรื่อย ๆ
        Assert.True(keys[^1].Length <= 6, $"rank ตัวท้ายยาว {keys[^1].Length}: '{keys[^1]}'");
    }

    [Fact]
    public void Between_PrependingStaysSorted()
    {
        var keys = new List<string>();
        string? next = null;

        for (var i = 0; i < 200; i++)
        {
            next = FractionalIndex.Between(null, next);
            keys.Insert(0, next);
        }

        Assert.Equal(keys.Order(StringComparer.Ordinal).ToList(), keys);
    }

    [Fact]
    public void BetweenMany_ProducesRequestedCountInOrder()
    {
        foreach (var count in new[] { 1, 2, 3, 10, 50 })
        {
            var between = FractionalIndex.BetweenMany("a0", "a1", count);
            Assert.Equal(count, between.Count);
            Assert.Equal(between.Order(StringComparer.Ordinal).ToList(), between);
            Assert.True(string.CompareOrdinal("a0", between[0]) < 0);
            Assert.True(string.CompareOrdinal(between[^1], "a1") < 0);

            var trailing = FractionalIndex.BetweenMany("a0", null, count);
            Assert.Equal(count, trailing.Count);
            Assert.Equal(trailing.Order(StringComparer.Ordinal).ToList(), trailing);

            var leading = FractionalIndex.BetweenMany(null, "a0", count);
            Assert.Equal(count, leading.Count);
            Assert.Equal(leading.Order(StringComparer.Ordinal).ToList(), leading);
            Assert.True(string.CompareOrdinal(leading[^1], "a0") < 0);
        }
    }

    [Theory]
    [InlineData("a1", "a0")]   // สลับลำดับ
    [InlineData("a0", "a0")]   // เท่ากัน
    public void Between_RejectsOutOfOrderInput(string a, string b)
        => Assert.Throws<ArgumentException>(() => FractionalIndex.Between(a, b));

    [Theory]
    [InlineData("")]           // ว่าง
    [InlineData("0")]          // หัวไม่ถูกต้อง
    [InlineData("a")]          // สั้นกว่าที่หัวบอก
    [InlineData("a00")]        // ลงท้ายด้วยศูนย์
    public void Between_RejectsMalformedKey(string key)
        => Assert.Throws<ArgumentException>(() => FractionalIndex.Between(key, null));
}
