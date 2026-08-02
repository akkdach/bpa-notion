using YDotNet.Document;
using YDotNet.Document.Cells;
using YDotNet.Document.Options;
using YDotNet.Document.Transactions;
using YDotNet.Document.Types.XmlElements;
using YDotNet.Document.Types.XmlFragments;
using YDotNet.Document.Types.XmlTexts;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  เขียนย่อหน้าต่อท้ายเอกสาร BlockNote ฝั่งเซิร์ฟเวอร์
//
//  นี่คือจุดเดียวในระบบที่เซิร์ฟเวอร์ "เขียน" Yjs — ทุกที่อื่นมองมันเป็น bytea
//  ทึบ ๆ โดยเจตนา (PLAN.md การตัดสินใจข้อ 1) จึงมีกฎเข้มกว่าปกติ
//
//  ⚠️ ขอบเขต: heading / list / quote / codeBlock / divider / paragraph
//     ยังไม่มี mark (ตัวหนา เอียง ลิงก์) ตาราง รูป และการซ้อนชั้น
//
//     เดิมรับแค่ย่อหน้าเพราะ "ไม่มีอะไรตรวจว่ารูปร่างตรงกับ blockToNode.ts"
//     (`@blocknote/server-util` ตายที่ 0.27.2 ขณะที่โปรเจกต์ pin 0.52.1)
//     ตอนนี้มีแล้ว: `@blocknote/core` export `markdownToHTML()` ซึ่งเป็น parser
//     ที่ BlockNote เขียนเอง ไม่มี dependency และรันใน Node เปล่า ๆ ได้
//     scripts/verify-blocknote-append.mjs จึงเทียบลำดับชนิดบล็อกที่ออกจากที่นี่
//     กับ parser ของ BlockNote เอง ไม่ใช่กับสิ่งที่เราคิดว่าถูก
//
//     ⚠️ ยังคงเป็นชุดที่ "ปิด" ไม่ใช่การรองรับทุกอย่าง — ทุกชนิดที่เพิ่มต้องผ่าน
//        node.check() **และ** การ assert textContent ก่อนถือว่าใช้ได้ (ดูด้านล่าง)
//
//  ⚠️ รูปร่างที่ผิดทำข้อมูลหายจริง ไม่ใช่แค่ render พลาด — สองแบบ:
//
//     1. element เดียวผิด schema → y-prosemirror ลบ element นั้นแล้ว
//        "กระจายการลบไปทุก client"
//     2. ระดับบนสุดไม่ใช่ blockGroup เดียว → tr.replace() throw นอก try/catch
//        → editor ไม่ render เลยทุกเครื่อง และไม่ self-heal
//
//     กรณีที่ 2 คือเหตุผลที่โค้ดนี้ "สร้าง blockGroup ให้เองเมื่อยังไม่มี" แทนที่จะ
//     สมมติว่ามีอยู่แล้ว — หน้าที่ AI สร้างและยังไม่มีใครเปิดจะมี fragment ว่างเปล่า
//
//  ⚠️ scripts/verify-blocknote-append.mjs ตรวจ bytes ที่ออกจากที่นี่ด้วย schema
//     จริงของ BlockNote แล้วเรียก node.check() ซึ่งเป็นตัวเดียวที่จับรูปร่างผิดได้
//     (yXmlFragmentToProseMirrorRootNode เองไม่ validate — พิสูจน์แล้ว)
//
//  ⚠️ แต่ node.check() "ไม่พอ" — ทดลองแล้วว่าถ้าใส่ชื่อ mark หรือ attribute
//     ที่ schema ไม่รู้จัก y-prosemirror จะลบข้อความทิ้งแล้ว check() ยังผ่าน
//     ทุกเคสจึงต้อง assert textContent ด้วยเสมอ ไม่ใช่แค่ check()
// ═══════════════════════════════════════════════════════════════════════════
public static class BlockNoteWriter
{
    /// <summary>ชื่อ root fragment — ต้องตรงกับ PageEditor.tsx เป๊ะ ๆ</summary>
    public const string FragmentName = "blocknote";

    private const string BlockGroup = "blockGroup";
    private const string BlockContainer = "blockContainer";

    /// <summary>
    /// Yjs clientID ที่จองไว้ให้เซิร์ฟเวอร์
    /// </summary>
    /// <remarks>
    /// ⚠️ ⚠️ ต้องต่ำกว่า 2^32 — เรื่องนี้เสียเวลาหาสาเหตุนานที่สุดในไฟล์นี้
    ///
    ///    yrs (ฝั่ง C#) เขียน clientID เป็น u64 ส่วน yjs 13.x (ฝั่งเบราว์เซอร์)
    ///    ไม่ round-trip ค่าที่เกิน 32 บิตให้ตรงกัน ผลคือ item เดียวกันได้ identity
    ///    คนละอันในสองฝั่ง แล้วอาการที่เห็นคือ:
    ///
    ///      · ≥ 2^53  → lib0 โยน "Integer out of Range" ตอน decode
    ///                  เอกสารทั้งก้อนอ่านไม่ได้ในเบราว์เซอร์
    ///      · 2^32..2^53 → ไม่ throw แต่ "เงียบและแย่กว่า":
    ///                  - update ที่ต่อท้ายถูก yjs พักไว้ใน pendingStructs
    ///                    โดยที่ missing = {} แล้วไม่ถูก integrate เลย
    ///                  - ถ้าส่ง full state แทน diff จะได้เนื้อหา "ซ้ำสองรอบ"
    ///                    เพราะ yjs มองว่าเป็น item คนละตัว
    ///
    ///    ทั้งสองแบบเซิร์ฟเวอร์รายงานว่าเขียนสำเร็จ (HTTP 200, seq เดินหน้า)
    ///    ซึ่งคือกรณีที่แย่ที่สุด — เชื่อว่าเขียนแล้วทั้งที่ผู้ใช้ไม่เคยเห็น
    ///
    ///    ช่วงเดียวกับที่เบราว์เซอร์ใช้ (yjs สุ่ม Math.random() * 2^32) จึงเป็น
    ///    ช่วงเดียวที่ interop ได้จริง ทดสอบแล้วใน verify-blocknote-append.mjs
    ///
    /// ⚠️ แปลว่า "จองช่วงเลขไว้ให้เซิร์ฟเวอร์" แบบที่ตั้งใจไว้ตอนแรกทำไม่ได้
    ///    การไล่ว่า update ไหนมาจากเซิร์ฟเวอร์จึงดูที่ page_doc_updates.author_user_id
    ///    (บัญชี agent) แทน ซึ่งเชื่อถือได้กว่าการเดาจากช่วงเลขอยู่แล้ว
    ///
    ///    การชนกับเบราว์เซอร์ที่เปิดอยู่: สุ่มใหม่ทุกครั้งจากช่วง 2^32 และ Doc
    ///    ของเซิร์ฟเวอร์มีอายุแค่ภายในคำขอเดียว โอกาสชนจึงต่ำมากและไม่สะสม
    /// </remarks>
    private const ulong MaxClientIdExclusive = 1UL << 32;

    /// <summary>
    /// สร้าง Yjs update ที่ต่อท้ายย่อหน้าเข้าไปในเอกสาร
    /// </summary>
    /// <param name="existingUpdates">
    /// update ทั้งหมดของเอกสารตามลำดับ (snapshot ก่อน แล้วตามด้วย update ที่เหลือ)
    /// ว่างได้ = เอกสารใหม่ที่ยังไม่มีอะไรเลย
    /// </param>
    /// <param name="paragraphs">ข้อความ ย่อหน้าละหนึ่งรายการ</param>
    /// <returns>
    /// ไบต์ของ update ที่ต้อง append เข้า log พร้อม clientID ที่ใช้เขียน
    ///
    /// update เป็น "ส่วนต่าง" ไม่ใช่เอกสารทั้งก้อน จึงรวมกับสิ่งที่ client อื่นเขียน
    /// พร้อมกันได้ตามปกติของ CRDT
    /// </returns>
    public static AppendUpdate BuildAppendUpdate(
        IReadOnlyList<byte[]> existingUpdates, IReadOnlyList<string> paragraphs)
    {
        ArgumentNullException.ThrowIfNull(paragraphs);

        return BuildAppendUpdate(existingUpdates,
            [.. paragraphs.Select(text => new BlockDraft(
                MarkdownToBlockNote.Paragraph, ParagraphAttributes, text, [], []))]);
    }

    private static readonly IReadOnlyDictionary<string, string> ParagraphAttributes
        = new Dictionary<string, string>();

    /// <summary>
    /// สร้าง Yjs update ที่ต่อท้ายบล็อกหลายชนิดเข้าไปในเอกสาร
    /// </summary>
    /// <param name="existingUpdates">
    /// update ทั้งหมดของเอกสารตามลำดับ (snapshot ก่อน แล้วตามด้วย update ที่เหลือ)
    /// ว่างได้ = เอกสารใหม่ที่ยังไม่มีอะไรเลย
    /// </param>
    /// <param name="blocks">โครงบล็อกจาก <see cref="MarkdownToBlockNote"/></param>
    public static AppendUpdate BuildAppendUpdate(
        IReadOnlyList<byte[]> existingUpdates, IReadOnlyList<BlockDraft> blocks)
    {
        ArgumentNullException.ThrowIfNull(blocks);

        // ─────────────────────────────────────────────────────────────────
        //  ⚠️ สุ่ม clientID ใหม่ "ทุกครั้ง" ห้ามใช้ค่าคงที่
        //
        //  แต่ละคำขอสร้าง Doc ใหม่ที่นาฬิกาภายในเริ่มจากศูนย์ ถ้าใช้ clientID
        //  เดิมซ้ำ item ที่เขียนรอบใหม่จะได้ (clientID, clock) ชุดเดิมกับของรอบก่อน
        //  → Yjs มองว่า "รู้จักแล้ว" แล้วทิ้งทั้ง update เงียบ ๆ
        //
        //  อาการคือเขียนสำเร็จทุกครั้ง (HTTP 200, seq เดินหน้า) แต่มีแค่รอบแรก
        //  ที่ปรากฏจริง — เจอมาแล้วตอนเขียนเทสนี้ และเป็นบั๊กที่มองไม่เห็นเลย
        //  ถ้าไม่ตรวจ "จำนวนย่อหน้าหลังเขียนซ้ำ"
        //
        //  การสุ่มไม่เสียอะไร: การเขียนแต่ละครั้งเป็น contribution อิสระ ไม่ต้องมี
        //  identity ต่อเนื่อง
        // ─────────────────────────────────────────────────────────────────
        var clientId = (ulong)Random.Shared.NextInt64(1, (long)MaxClientIdExclusive);

        using var doc = new Doc(new DocOptions { Id = clientId });

        // ─── 0) ลงทะเบียน root type ก่อนเปิดธุรกรรมใด ๆ ───────────────────
        //
        // ⚠️ ลำดับนี้บังคับด้วยข้อจำกัดสองข้อที่ขัดกันของ YDotNet:
        //      · doc.XmlFragment(name) เป็นตัว "นิยาม" root type แต่ throw
        //        ถ้ามีธุรกรรมเปิดอยู่
        //      · tx.GetXmlFragment(name) เรียกได้ในธุรกรรม แต่คืน null ถ้า type
        //        ยังไม่เคยถูกนิยาม
        //    จึงต้องหยิบ handle ตรงนี้ครั้งเดียว แล้วใช้ตัวเดิมข้ามธุรกรรม
        var fragment = doc.XmlFragment(FragmentName);

        // ─── 1) ประกอบเอกสารปัจจุบันขึ้นมาก่อน ────────────────────────────
        //
        // ต้องรู้สถานะปัจจุบันเพื่อ (ก) หา blockGroup ที่มีอยู่ ไม่สร้างซ้ำ
        // และ (ข) คำนวณ state vector ก่อนแก้ เพื่อให้ diff ที่ได้เป็นเฉพาะ
        // สิ่งที่เราเพิ่ม ไม่ใช่ทั้งเอกสาร
        if (existingUpdates.Count > 0)
        {
            using var load = doc.WriteTransaction(origin: null!);
            foreach (var update in existingUpdates)
            {
                if (update.Length == 0) continue;
                load.ApplyV1(update);
            }
            load.Commit();
        }

        byte[] before;
        using (var read = doc.ReadTransaction())
        {
            before = read.StateVectorV1();
        }

        // ─── 2) เขียนบล็อกต่อท้าย ────────────────────────────────────────
        using (var write = doc.WriteTransaction(origin: null!))
        {
            var group = EnsureBlockGroup(write, fragment);

            WriteBlocks(write, group, blocks, group.ChildLength(write));

            write.Commit();
        }

        // ─── 3) เอาเฉพาะส่วนต่าง ─────────────────────────────────────────
        using var diff = doc.ReadTransaction();
        return new AppendUpdate(diff.StateDiffV1(before), clientId);
    }

    /// <summary>เขียนบล็อกลง blockGroup ที่ให้มา ตั้งแต่ตำแหน่ง <paramref name="startIndex"/></summary>
    private static void WriteBlocks(
        Transaction write, XmlElement group,
        IReadOnlyList<BlockDraft> blocks, uint startIndex)
    {
        var index = startIndex;

        foreach (var block in blocks)
        {
            var container = group.InsertElement(write, index, BlockContainer);

            // id เป็น attribute เดียวที่ schema บังคับ — ตัวอื่น (textColor,
            // backgroundColor, textAlignment) มี default ใน schema อยู่แล้ว
            // ProseMirror จึงเติมให้เอง การใส่มาเองมีแต่จะเพิ่มโอกาสสะกดผิด
            container.InsertAttribute(write, "id", Guid.CreateVersion7().ToString());

            var content = container.InsertElement(write, 0, block.Tag);

            // ⚠️ attribute ของ Yjs เป็นสตริงเสมอ (InsertAttribute รับได้แค่ string)
            //    เบราว์เซอร์จึงได้ level = "2" ไม่ใช่ 2 — render ถูกเพราะ BlockNote
            //    ต่อสตริง ("h" + "2") และ ProseMirror ไม่ validate ชนิดของ attr
            //    อย่า "แก้" ให้เป็นตัวเลข เพราะเขียนแบบนั้นไม่ได้
            foreach (var (name, value) in block.Attributes)
            {
                content.InsertAttribute(write, name, value);
            }

            // ⚠️ null หรือว่าง = ไม่มี text node เลย ไม่ใช่ text node ที่ยาว 0
            //    ProseMirror ไม่มี text node ว่าง การใส่เข้าไปทำให้ check() ไม่ผ่าน
            if (block.Text is { Length: > 0 } text)
            {
                var xmlText = content.InsertText(write, 0);

                // ⚠️ Insert ครั้งเดียว แล้วค่อย Format เป็นช่วง ๆ
                //
                //    Insert ที่ attributes เป็น null "สืบทอดรูปแบบจากตำแหน่งนั้น"
                //    (พฤติกรรมของ Yjs ไม่ใช่ของเรา) ถ้าเขียนทีละช่วงด้วย Insert
                //    ข้อความที่ตามหลังช่วงตัวหนาจะกลายเป็นตัวหนาไปด้วยเงียบ ๆ
                //    การ Format ทับทีหลังไม่มีปัญหานี้ — พิสูจน์แล้วใน spike-marks
                xmlText.Insert(write, 0, text, null!);
                ApplyMarks(write, xmlText, block);
            }

            // ─────────────────────────────────────────────────────────────
            //  ลิสต์ซ้อนชั้น — blockGroup ลูกอยู่ "ข้าง ๆ" เนื้อหา ไม่ใช่ข้างใน
            //  (schema: blockContainer = blockContent blockGroup?)
            //
            //  ⚠️ เขียนเฉพาะเมื่อมีลูกจริง — blockGroup ที่ว่างผิด content
            //     expression (blockGroupChild+) แล้ว y-prosemirror จะลบมันทิ้ง
            //     ซึ่งเป็นการลบที่กระจายไปทุกเครื่อง
            // ─────────────────────────────────────────────────────────────
            if (block.Children.Count > 0)
            {
                var childGroup = container.InsertElement(write, 1, BlockGroup);
                WriteBlocks(write, childGroup, block.Children, 0);
            }

            index++;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ใส่ตัวหนา/เอียง/ขีดฆ่า/โค้ด/ลิงก์
    //
    //  ⚠️ ชื่อ mark ต้องตรงกับ defaultStyleSpecs ของ BlockNote เป๊ะ
    //     ชื่อที่ schema ไม่รู้จักทำให้ "ข้อความช่วงนั้นถูกลบทิ้ง" โดยที่
    //     node.check() ยังผ่าน — เป็นความเสียหายที่มองไม่เห็นจากฝั่งเซิร์ฟเวอร์เลย
    //     verify-blocknote-append.mjs จึง assert textContent ทุกเคส ไม่ใช่แค่ check()
    //
    //  ⚠️ ค่าของ mark คือ "attrs object" ของมัน ไม่ใช่ true — bold/italic/strike/code
    //     ใช้ object ว่าง ส่วน link ต้องมี { href }
    //
    //  offset เป็นหน่วย UTF-16 code unit ตรงกับ C# string.Length และ yjs
    //  (DocOptions.Encoding เป็น Utf16 โดยปริยาย — ห้ามไปตั้งเป็น Utf8)
    // ═══════════════════════════════════════════════════════════════════════
    private static void ApplyMarks(Transaction write, XmlText xmlText, BlockDraft block)
    {
        if (block.Runs.Count == 0) return;

        // ⚠️ กันไว้อีกชั้นถึงแม้ MarkdownToBlockNote จะไม่มีทางสร้าง run ให้ codeBlock
        //    เพราะนี่คือรูปร่างเดียวที่ทำให้ "เอกสารว่างทั้งหน้า" ไม่ใช่แค่บล็อกเดียวพัง
        if (string.Equals(block.Tag, MarkdownToBlockNote.CodeBlock, StringComparison.Ordinal))
        {
            return;
        }

        var length = block.Text?.Length ?? 0;

        foreach (var run in block.Runs)
        {
            var start = Math.Clamp(run.Start, 0, length);
            var end = Math.Clamp(run.Start + run.Length, start, length);
            if (end == start) continue;

            var attrs = new Dictionary<string, Input>
            {
                [run.Name] = run.Href is { } href
                    ? Input.Object(new Dictionary<string, Input> { ["href"] = Input.String(href) })
                    : Input.Object(new Dictionary<string, Input>()),
            };

            using var input = Input.Object(attrs);
            xmlText.Format(write, (uint)start, (uint)(end - start), input);
        }
    }

    /// <summary>
    /// หา blockGroup ที่ระดับบนสุด หรือสร้างให้ถ้ายังไม่มี
    /// </summary>
    /// <remarks>
    /// ⚠️ นี่คือส่วนที่พังแล้วเจ็บที่สุด — doc ของ BlockNote มี content = "blockGroup"
    ///    ตัวเดียวเป๊ะ ถ้า fragment ระดับบนสุดมีอย่างอื่นหรือมีหลายตัว
    ///    tr.replace() ของ y-prosemirror จะ throw นอก try/catch แล้ว editor
    ///    ไม่ render เลยทุกเครื่อง
    ///
    ///    หน้าที่สร้างผ่าน API แล้วยังไม่มีใครเปิดในเบราว์เซอร์จะมี fragment
    ///    ว่างเปล่า ทางนี้จึงเป็นทางปกติ ไม่ใช่ทางหลบ
    /// </remarks>
    private static XmlElement EnsureBlockGroup(Transaction tx, XmlFragment fragment)
    {
        var length = fragment.ChildLength(tx);

        for (uint i = 0; i < length; i++)
        {
            // ลูกที่ไม่ใช่ element (เช่น XmlText หลงมา) จะได้ null — ข้ามไป
            // ไม่ throw เพราะเราไม่ได้เป็นเจ้าของเอกสารนี้คนเดียว
            var child = fragment.Get(tx, i);
            var element = child?.XmlElement;

            if (element is not null &&
                string.Equals(element.Tag(tx), BlockGroup, StringComparison.Ordinal))
            {
                return element;
            }
        }

        return fragment.InsertElement(tx, length, BlockGroup);
    }
}

/// <param name="Bytes">Yjs update (ส่วนต่าง) ที่ต้อง append เข้า log</param>
/// <param name="ClientId">
/// clientID ที่ใช้เขียนรอบนี้ — สุ่มใหม่ทุกครั้งในช่วงที่จองไว้ให้เซิร์ฟเวอร์
/// เก็บลง y_client_id เพื่อให้ไล่ได้ว่า update ไหนไม่ได้มาจากเบราว์เซอร์
/// </param>
public readonly record struct AppendUpdate(byte[] Bytes, ulong ClientId);
