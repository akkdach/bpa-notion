using System.Text;
using Markdig;
using Markdig.Extensions.TaskLists;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  markdown → โครงบล็อกของ BlockNote
//
//  ชั้นนี้ "ไม่รู้จัก Yjs เลย" โดยเจตนา — มันแปลง markdown เป็น BlockDraft
//  แล้ว BlockNoteWriter ค่อยเปลี่ยนเป็น XmlElement
//
//  แยกกันเพราะสองเรื่องนี้พังคนละแบบและตรวจคนละวิธี: การแปล markdown ผิดคือ
//  ผลลัพธ์หน้าตาไม่ถูก ส่วนการเขียน Yjs ผิดคือ "ข้อมูลหายทุกเครื่อง"
//  (ดูคำเตือนใน BlockNoteWriter.cs) การเอามารวมกันจะกลบคำเตือนพวกนั้น
//
//  ⚠️ ชนิดบล็อกและ attribute ที่นี่ต้องตรงกับ schema จริงของ BlockNote 0.52.1
//     ตัวที่ตรวจคือ scripts/verify-blocknote-append.mjs ซึ่งเทียบลำดับชนิดบล็อก
//     กับ `markdownToHTML()` ของ @blocknote/core เอง — ไม่ใช่กับสิ่งที่เราคิดว่าถูก
//
//     BlockNoteWriter.cs เคยเขียนไว้ว่า "ไม่มีอะไรตรวจว่าตรงกัน" ซึ่งเป็นเหตุผล
//     ที่มันรับแค่ย่อหน้า — `markdownToHTML` เป็น parser ที่ BlockNote เขียนเอง
//     ไม่มี dependency และรันใน Node เปล่า ๆ ได้ ข้อจำกัดนั้นจึงหมดไป
// ═══════════════════════════════════════════════════════════════════════════
public static class MarkdownToBlockNote
{
    // ชื่อ node ต้องตรงกับ defaultBlockSpecs ของ BlockNote เป๊ะ ๆ
    public const string Paragraph = "paragraph";
    public const string Heading = "heading";
    public const string BulletListItem = "bulletListItem";
    public const string NumberedListItem = "numberedListItem";
    public const string CheckListItem = "checkListItem";
    public const string Quote = "quote";
    public const string CodeBlock = "codeBlock";
    public const string Divider = "divider";

    /// <summary>
    /// pipeline เล็กที่สุดที่พอใช้
    /// </summary>
    /// <remarks>
    /// ⚠️ ห้ามใช้ UseAdvancedExtensions() — มันเปิด ~20 extension (footnote,
    ///    figure, abbreviation, custom container, mathematics) ที่ต้อง map เพิ่ม
    ///    ทุกตัว มิฉะนั้นจะตกไปเป็นข้อความดิบแบบเดาไม่ได้ โดยที่ผู้ใช้ไม่ได้อะไรเลย
    ///
    ///    UsePipeTables เปิดไว้เพื่อ "จับตารางให้ได้" แล้วลดรูปเป็นบล็อกโค้ด
    ///    ไม่ใช่เพื่อรองรับตาราง — ถ้าไม่เปิด ตารางจะกลายเป็นย่อหน้าที่มี | เต็มไปหมด
    /// </remarks>
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseTaskLists()
        .UsePipeTables()
        // เฉพาะ ~~ขีดฆ่า~~ ไม่เอา subscript/superscript/inserted/marked ที่มาด้วยกัน
        // โดยปริยาย — สามตัวหลังไม่มี mark รองรับใน BlockNote
        .UseEmphasisExtras(Markdig.Extensions.EmphasisExtras.EmphasisExtraOptions.Strikethrough)
        .Build();

    public static MarkdownConversion Convert(string markdown)
    {
        ArgumentNullException.ThrowIfNull(markdown);

        var document = Markdown.Parse(markdown, Pipeline);
        var blocks = new List<BlockDraft>();
        var warnings = new SortedSet<string>(StringComparer.Ordinal);

        foreach (var block in document)
        {
            ConvertBlock(block, markdown, blocks, warnings);
        }

        return new MarkdownConversion(blocks, [.. warnings]);
    }

    private static void ConvertBlock(
        Block block, string source, List<BlockDraft> output, SortedSet<string> warnings)
    {
        switch (block)
        {
            case HeadingBlock heading:
                // level เขียนเป็นสตริงเพราะ XmlElement.InsertAttribute รับได้แค่ string
                // เบราว์เซอร์จึงได้ "2" ไม่ใช่ 2 ซึ่ง render ถูก (`"h" + "2"`)
                Emit(output, Heading, Text(heading.Inline, warnings),
                    new Dictionary<string, string>
                    {
                        ["level"] = Math.Clamp(heading.Level, 1, 6).ToString()
                    });
                break;

            case ParagraphBlock paragraph:
                Emit(output, Paragraph, Text(paragraph.Inline, warnings));
                break;

            case ListBlock list:
                ConvertList(list, source, output, warnings);
                break;

            case QuoteBlock quote:
                // ⚠️ schema ของ quote เป็น inline* — มันซ้อนย่อหน้าข้างในไม่ได้
                //    อ้างอิงหลายย่อหน้าจึงกลายเป็น quote หลายบล็อกพี่น้องกัน
                //    (ตรงกับที่ markdownToHTML ของ BlockNote ทำ)
                foreach (var child in quote)
                {
                    if (child is ParagraphBlock inner) Emit(output, Quote, Text(inner.Inline, warnings));
                    else ConvertBlock(child, source, output, warnings);
                }
                break;

            case FencedCodeBlock fenced:
                Emit(output, CodeBlock, Verbatim(CodeText(fenced)), Language(fenced.Info));
                break;

            case CodeBlock indented:
                Emit(output, CodeBlock, Verbatim(CodeText(indented)));
                break;

            case ThematicBreakBlock:
                // divider ไม่มีทั้งลูกและ attribute — Text ต้องเป็น null ไม่ใช่ ""
                output.Add(new BlockDraft(Divider, EmptyAttributes, null, [], []));
                break;

            // ─────────────────────────────────────────────────────────────
            //  ของที่ schema รับตรง ๆ ไม่ได้ → ลดรูปเป็นบล็อกโค้ด ไม่ทิ้ง
            //
            //  ผู้เรียกคือ LLM ที่มองผลลัพธ์ไม่เห็น การกลืนเงียบ ๆ แปลว่ามันเชื่อว่า
            //  เขียนตารางไปแล้ว ส่วนการตอบ 400 เสียรอบเดินทางแล้วมักได้ retry
            //  ด้วยเนื้อหาเดิม — "สำเร็จ และนี่คือสิ่งที่ถูกเปลี่ยน" เป็นผลลัพธ์เดียว
            //  ที่ทำให้มันแก้ตัวเองรอบหน้าได้
            // ─────────────────────────────────────────────────────────────
            case Markdig.Extensions.Tables.Table:
                Emit(output, CodeBlock, Verbatim(Slice(source, block)), Language("text"));
                warnings.Add("ตารางถูกเก็บเป็นบล็อกโค้ด — เนื้อหาครบแต่ยังไม่แสดงเป็นตารางจริง");
                break;

            case HtmlBlock:
                Emit(output, CodeBlock, Verbatim(Slice(source, block)), Language("html"));
                warnings.Add("HTML ถูกเก็บเป็นบล็อกโค้ด ไม่ถูกนำไปแสดงผล");
                break;

            case ContainerBlock container:
                foreach (var child in container) ConvertBlock(child, source, output, warnings);
                break;
        }
    }

    /// <summary>
    /// ความลึกของลิสต์ที่ยอมให้ซ้อนกัน
    /// </summary>
    /// <remarks>
    /// ลึกกว่านี้ถูกแบนเป็นชั้นสุดท้ายแล้วเตือนกลับ — markdown ที่ AI เขียนมัก
    /// ซ้อนลึกเกินจริงเพราะเยื้องผิด และทุกชั้นที่เพิ่มคือ blockGroup อีกอันที่
    /// ถ้าว่างจะถูก y-prosemirror ลบทิ้ง (เพราะ content เป็น blockGroupChild+)
    /// </remarks>
    private const int MaxListDepth = 3;

    private static void ConvertList(
        ListBlock list, string source, List<BlockDraft> output,
        SortedSet<string> warnings, int depth = 1)
    {
        foreach (var item in list.Cast<ListItemBlock>())
        {
            var tag = list.IsOrdered ? NumberedListItem : BulletListItem;
            IReadOnlyDictionary<string, string> attributes = EmptyAttributes;

            var content = new InlineText(string.Empty, []);
            var seenText = false;
            var children = new List<BlockDraft>();

            // บล็อกที่ไม่ใช่ลิสต์ซ้อน (เช่นย่อหน้าที่สองของรายการ) ไปเป็นพี่น้อง
            // ไม่ใช่ลูก — เพื่อไม่ให้เยื้องเพี้ยนจากที่ผู้เขียนตั้งใจ
            var siblings = new List<BlockDraft>();

            foreach (var child in item)
            {
                if (child is ParagraphBlock paragraph && !seenText)
                {
                    var task = FindTaskList(paragraph.Inline);

                    if (task is not null)
                    {
                        tag = CheckListItem;
                        // ⚠️ ห้ามเขียน checked="false" — "false" เป็นสตริงที่ truthy
                        //    ใน JS ช่องจะถูกติ๊กทั้งที่ markdown บอกว่ายังไม่ติ๊ก
                        //    ต้อง "ไม่มี attribute" ไปเลย
                        if (task.Checked)
                        {
                            attributes = new Dictionary<string, string> { ["checked"] = "true" };
                        }
                    }

                    content = Text(paragraph.Inline, warnings);
                    seenText = true;
                    continue;
                }

                if (child is ListBlock nested)
                {
                    if (depth >= MaxListDepth)
                    {
                        warnings.Add($"รายการซ้อนลึกเกิน {MaxListDepth} ชั้น ถูกปรับให้ตื้นลง");
                        ConvertList(nested, source, siblings, warnings, depth);
                    }
                    else
                    {
                        ConvertList(nested, source, children, warnings, depth + 1);
                    }
                    continue;
                }

                ConvertBlock(child, source, siblings, warnings);
            }

            // ⚠️ รายการที่ไม่มีข้อความแต่มีลูก ต้องยังถูกเขียนอยู่ ไม่งั้นลูกจะกำพร้า
            //    ส่วนรายการที่ทั้งว่างและไม่มีลูก ไม่ต้องเขียน
            if (content.Text.Length > 0 || children.Count > 0)
            {
                output.Add(new BlockDraft(tag, attributes, content.Text, content.Runs, children));
            }

            output.AddRange(siblings);
        }
    }

    private static void Emit(
        List<BlockDraft> output, string tag, InlineText content,
        IReadOnlyDictionary<string, string>? attributes = null)
    {
        // ย่อหน้าที่ไม่มีข้อความเลยไม่ต้องเขียน — บล็อกเปล่าไม่ได้สื่ออะไร
        // ยกเว้น codeBlock ซึ่ง "ก้อนโค้ดว่าง" เป็นสิ่งที่ผู้เขียนตั้งใจได้
        if (content.Text.Length == 0 && tag != CodeBlock) return;

        output.Add(new BlockDraft(
            tag, attributes ?? EmptyAttributes, content.Text, content.Runs, []));
    }

    /// <summary>
    /// ข้อความที่ต้องคงไว้ตามตัวอักษร ไม่มี mark เลย
    /// </summary>
    /// <remarks>
    /// ⚠️ ใช้กับ codeBlock เท่านั้น — schema ของมันคือ marks:"" การใส่ mark เข้าไป
    ///    ทำให้ y-prosemirror ลบข้อความทิ้ง → codeBlock ว่าง → blockGroup ว่าง
    ///    → node.check() พังที่ระดับ doc ทั้งเอกสาร (ทดลองยืนยันแล้ว)
    ///    เป็นรูปร่างเดียวที่ทำให้เอกสารว่างทั้งหน้าได้
    /// </remarks>
    private static InlineText Verbatim(string text) => new(text, []);

    private static IReadOnlyDictionary<string, string> EmptyAttributes { get; }
        = new Dictionary<string, string>();

    private static Dictionary<string, string>? Language(string? info)
    {
        var language = info?.Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(language)
            ? null
            : new Dictionary<string, string> { ["language"] = language };
    }

    private static string CodeText(CodeBlock code)
    {
        var builder = new StringBuilder();

        for (var i = 0; i < code.Lines.Count; i++)
        {
            if (i > 0) builder.Append('\n');
            builder.Append(code.Lines.Lines[i].Slice.ToString());
        }

        return builder.ToString();
    }

    /// <summary>markdown ดิบของบล็อกนี้ — ใช้ตอนลดรูปของที่ schema รับไม่ได้</summary>
    private static string Slice(string source, Block block)
    {
        var start = Math.Clamp(block.Span.Start, 0, source.Length);
        var end = Math.Clamp(block.Span.End + 1, start, source.Length);
        return source[start..end].TrimEnd();
    }

    private static TaskList? FindTaskList(ContainerInline? inline)
        => inline?.FirstOrDefault() as TaskList;

    // ═══════════════════════════════════════════════════════════════════════
    //  ข้อความ + ช่วงที่ต้องใส่ mark
    //
    //  ⚠️ ชื่อ mark ต้องตรงกับ defaultStyleSpecs ของ BlockNote เป๊ะ
    //     ชื่อที่ schema ไม่รู้จักทำให้ "ข้อความถูกลบเงียบ ๆ" โดยที่ node.check()
    //     ยังผ่าน (ทดลองยืนยันแล้ว) — จึงมีแค่ห้าตัวนี้ ไม่รับชื่ออื่นเลย
    //
    //  ⚠️ offset เป็นหน่วย UTF-16 code unit ตรงกับทั้ง C# string.Length และ yjs
    //     (DocOptions.Encoding ปล่อยเป็นค่าเริ่มต้น Utf16 — ห้ามตั้งเป็น Utf8)
    // ═══════════════════════════════════════════════════════════════════════
    public const string MarkBold = "bold";
    public const string MarkItalic = "italic";
    public const string MarkStrike = "strike";
    public const string MarkCode = "code";
    public const string MarkLink = "link";

    private static InlineText Text(ContainerInline? inline, SortedSet<string> warnings)
    {
        if (inline is null) return new InlineText(string.Empty, []);

        var builder = new StringBuilder();
        var runs = new List<MarkRun>();
        Append(inline.FirstChild, builder, runs, [], warnings);

        return TrimTo(builder.ToString(), runs);
    }

    /// <summary>ตัดช่องว่างหัวท้ายแล้วเลื่อน/ตัดช่วง mark ให้ตรงกับข้อความใหม่</summary>
    private static InlineText TrimTo(string raw, List<MarkRun> runs)
    {
        var start = 0;
        while (start < raw.Length && char.IsWhiteSpace(raw[start])) start++;

        var end = raw.Length;
        while (end > start && char.IsWhiteSpace(raw[end - 1])) end--;

        var text = raw[start..end];
        if (text.Length == 0) return new InlineText(string.Empty, []);

        var shifted = new List<MarkRun>(runs.Count);

        foreach (var run in runs)
        {
            var from = Math.Max(run.Start - start, 0);
            var to = Math.Min(run.Start + run.Length - start, text.Length);
            if (to > from) shifted.Add(run with { Start = from, Length = to - from });
        }

        return new InlineText(text, shifted);
    }

    private static void Append(
        Inline? inline, StringBuilder builder, List<MarkRun> runs,
        IReadOnlyList<MarkRun> active, SortedSet<string> warnings)
    {
        for (var node = inline; node is not null; node = node.NextSibling)
        {
            switch (node)
            {
                case LiteralInline literal:
                    Mark(builder.Length, literal.Content.Length, active, runs);
                    builder.Append(literal.Content.AsSpan());
                    break;

                case CodeInline code:
                    Mark(builder.Length, code.Content.Length,
                        [.. active, new MarkRun(0, 0, MarkCode, null)], runs);
                    builder.Append(code.Content);
                    break;

                // soft break เป็น "ช่องว่าง" ไม่ใช่ขึ้นบรรทัด — ProseMirror ไม่มี
                // text node ที่มี \n อยู่ข้างใน และการแตกบล็อกตรงนี้จะผิดความหมาย
                case LineBreakInline:
                    builder.Append(' ');
                    break;

                case TaskList:
                    // เครื่องหมาย [x] ถูกแปลงเป็น attribute ไปแล้ว ไม่ต้องซ้ำในข้อความ
                    break;

                case AutolinkInline auto:
                    Mark(builder.Length, auto.Url.Length,
                        [.. active, new MarkRun(0, 0, MarkLink, auto.Url)], runs);
                    builder.Append(auto.Url);
                    break;

                case LinkInline { IsImage: true } image:
                    AppendImage(image, builder, runs, active, warnings);
                    break;

                case LinkInline link:
                    Append(link.FirstChild, builder, runs,
                        [.. active, new MarkRun(0, 0, MarkLink, link.Url ?? string.Empty)],
                        warnings);
                    break;

                case EmphasisInline emphasis:
                    var mark = EmphasisMark(emphasis);
                    Append(emphasis.FirstChild, builder, runs,
                        mark is null ? active : [.. active, new MarkRun(0, 0, mark, null)],
                        warnings);
                    break;

                case ContainerInline container:
                    Append(container.FirstChild, builder, runs, active, warnings);
                    break;
            }
        }
    }

    /// <summary>รูปกลายเป็นข้อความ + ลิงก์ — ไม่ทำ image block ที่ต้องเดา props</summary>
    private static void AppendImage(
        LinkInline image, StringBuilder builder, List<MarkRun> runs,
        IReadOnlyList<MarkRun> active, SortedSet<string> warnings)
    {
        warnings.Add("รูปภาพถูกแปลงเป็นลิงก์ — เซิร์ฟเวอร์ยังแนบไฟล์เข้าหน้าไม่ได้");

        var label = new StringBuilder();
        Append(image.FirstChild, label, [], [], warnings);

        var url = image.Url ?? string.Empty;
        var text = label.Length > 0 ? label.ToString() : url;
        if (text.Length == 0) return;

        Mark(builder.Length, text.Length,
            url.Length > 0 ? [.. active, new MarkRun(0, 0, MarkLink, url)] : active, runs);
        builder.Append(text);
    }

    private static string? EmphasisMark(EmphasisInline emphasis) => emphasis.DelimiterChar switch
    {
        '~' => emphasis.DelimiterCount >= 2 ? MarkStrike : null,
        '*' or '_' => emphasis.DelimiterCount >= 2 ? MarkBold : MarkItalic,
        _ => null,
    };

    private static void Mark(
        int start, int length, IReadOnlyList<MarkRun> active, List<MarkRun> runs)
    {
        if (length == 0 || active.Count == 0) return;

        foreach (var mark in active)
        {
            runs.Add(mark with { Start = start, Length = length });
        }
    }
}

/// <param name="Start">ตำแหน่งเริ่ม เป็นหน่วย UTF-16 code unit</param>
/// <param name="Href">มีค่าเฉพาะ mark ชื่อ link</param>
public readonly record struct MarkRun(int Start, int Length, string Name, string? Href);

internal sealed record InlineText(string Text, IReadOnlyList<MarkRun> Runs);

/// <param name="Tag">ชื่อ node ของ BlockNote เช่น paragraph / heading / codeBlock</param>
/// <param name="Text">null = ไม่มี text node เลย (divider) ต่างจาก "" ที่ยังมี node ว่าง</param>
/// <param name="Runs">ช่วงที่ต้องใส่ mark — ต้องว่างเสมอสำหรับ codeBlock</param>
/// <param name="Children">ลิสต์ซ้อนชั้น</param>
public sealed record BlockDraft(
    string Tag,
    IReadOnlyDictionary<string, string> Attributes,
    string? Text,
    IReadOnlyList<MarkRun> Runs,
    IReadOnlyList<BlockDraft> Children);

/// <param name="Warnings">สิ่งที่ถูกลดรูป — ต้องส่งกลับถึงผู้เรียกเสมอ ไม่ใช่ log ทิ้ง</param>
public sealed record MarkdownConversion(
    IReadOnlyList<BlockDraft> Blocks,
    IReadOnlyList<string> Warnings);
