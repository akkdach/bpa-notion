// ═══════════════════════════════════════════════════════════════════════════
//  BlockNote + Yjs — เทสที่ไม่ต้องมีฐานข้อมูล
//
//  ⚠️ สิ่งที่ต้องพิสูจน์คือของเดิมพิสูจน์ไม่ได้: "รูปร่างที่เซิร์ฟเวอร์เขียน
//     ถูกต้องตาม schema ของ BlockNote จริงไหม"
//
//     ฝั่ง .NET ต้องมี scripts/verify-blocknote-append.mjs แยกต่างหากมาเรียก
//     node.check() เพราะ YDotNet ประกอบ XML อะไรก็ได้โดยไม่มีอะไรค้าน
//     ที่นี่เรียก node.check() ได้ในเทสปกติ เพราะ schema อยู่ในมือแล้ว
//
//  ⚠️ check() อย่างเดียวไม่พอ — ฝั่ง .NET ทดลองแล้วว่า mark หรือ attribute ที่
//     schema ไม่รู้จักทำให้ข้อความ "หายไป" โดยที่ check() ยังผ่าน ทุกเคสจึงต้อง
//     assert ข้อความที่ได้กลับมาด้วยเสมอ
// ═══════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  appendBlocks,
  blocksToPlainText,
  FRAGMENT_NAME,
  markdownToBlocks,
  paragraphBlocks,
  readPlainText,
  replaceBlocks,
} from '../src/documents/blocknote.js';

/** ประกอบเอกสารจาก update ทั้งหมด แล้วตรวจด้วย schema จริงของ BlockNote */
async function inspect(updates: Uint8Array[]) {
  const { yXmlFragmentToProseMirrorRootNode } = await import('y-prosemirror');
  const bn = (await import('@blocknote/core')) as unknown as {
    BlockNoteEditor: { create(o: { _headless: true }): { pmSchema: never } };
  };

  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(FRAGMENT_NAME);
  for (const u of updates) Y.applyUpdate(doc, u);

  const schema = bn.BlockNoteEditor.create({ _headless: true }).pmSchema;
  const node = yXmlFragmentToProseMirrorRootNode(fragment, schema);

  // ⚠️ throw เมื่อรูปร่างผิด — เป็นตัวเดียวที่จับ "element ที่ y-prosemirror
  //    จะลบทิ้งแล้วกระจายการลบไปทุก client" ได้
  node.check();

  const types: string[] = [];
  node.forEach((group) => group.forEach((c) => types.push(c.firstChild?.type.name ?? '?')));

  return { node, types, text: node.textContent };
}

describe('markdown → บล็อก', () => {
  it('รองรับชนิดบล็อกที่ใช้จริงครบ', async () => {
    const blocks = await markdownToBlocks(
      '# หัวข้อ\n\nย่อหน้า\n\n- ก\n- ข\n\n1. หนึ่ง\n\n> คำพูด\n\n```js\nconst x = 1;\n```\n\n---\n',
    );

    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'bulletListItem',
      'bulletListItem',
      'numberedListItem',
      'quote',
      'codeBlock',
      'divider',
    ]);
  });

  it('mermaid ยังเป็น codeBlock ไม่ถูกแตกเป็นบรรทัด', async () => {
    // ⚠️ เหตุผลที่ append markdown ต้องแยกจาก append ย่อหน้า: ทางย่อหน้าแตก
    //    ทุกอย่างที่ \n ซึ่งจะฉีกผังงานเป็นชิ้น ๆ
    const blocks = await markdownToBlocks('```mermaid\ngraph TD;\nA-->B;\n```');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('codeBlock');
    expect(blocksToPlainText(blocks)).toContain('A-->B;');
  });

  it('newline ในบล็อกโค้ดต้องรอด — mermaid หลายบรรทัดวาดไม่ออกถ้าถูกยุบ', async () => {
    // ⚠️ linkedom ยุบ newline ใน <pre> เป็นช่องว่าง (เบราว์เซอร์จริงไม่เป็น)
    //    restoreCodeBlockNewlines เอาเนื้อดิบจาก fence มาแทน — เทสนี้ล็อกไว้
    const blocks = await markdownToBlocks('```mermaid\nflowchart LR\n    A[หนึ่ง] -->|เส้น| B[สอง]\n    B --> C\n```');

    expect(blocks).toHaveLength(1);
    expect(blocksToPlainText(blocks)).toBe('flowchart LR\n    A[หนึ่ง] -->|เส้น| B[สอง]\n    B --> C');
  });

  it('หลาย fence ในเอกสารเดียว จับคู่ถูกตัวตามลำดับ', async () => {
    const blocks = await markdownToBlocks('```js\nconst a = 1;\nconst b = 2;\n```\n\nคั่นกลาง\n\n```mermaid\ngraph TD\nX-->Y\n```');

    const codes = blocks.filter((b) => b.type === 'codeBlock');
    expect(codes).toHaveLength(2);
    expect(blocksToPlainText([codes[0]!])).toBe('const a = 1;\nconst b = 2;');
    expect(blocksToPlainText([codes[1]!])).toBe('graph TD\nX-->Y');
  });

  it('ตาราง GFM → บล็อก table จริง ไม่ถูกลดรูปเป็นบล็อกโค้ด', async () => {
    // เอกสารยุค .NET บอกว่า "ตารางถูกลดรูป" — parser ของ BlockNote เองรองรับแล้ว
    // เทสนี้ล็อกไว้ไม่ให้ถอยกลับตอนอัปเกรด BlockNote
    const blocks = await markdownToBlocks('| ชื่อ | ค่า |\n| --- | --- |\n| หนึ่ง | 1 |');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('table');
  });

  it('รูปจาก URL → บล็อก image จริง ไม่ถูกลดรูปเป็นข้อความ', async () => {
    const blocks = await markdownToBlocks('![คำบรรยาย](https://example.com/a.png)');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('image');
    expect((blocks[0] as { props?: { url?: string } }).props?.url).toBe('https://example.com/a.png');
  });
});

describe('เขียนลง Y.Doc', () => {
  it('เอกสารว่าง → เขียนได้และรูปร่างผ่าน schema', async () => {
    const blocks = await markdownToBlocks('# หัวข้อ\n\nเนื้อหา');
    const written = await appendBlocks([], blocks);

    expect(written).not.toBeNull();

    const { types, text } = await inspect([written!.update]);
    expect(types).toEqual(['heading', 'paragraph']);
    expect(text).toContain('หัวข้อ');
    expect(text).toContain('เนื้อหา');
  });

  it('ต่อท้ายเอกสารเดิม — ของเดิมยังอยู่ครบและ diff เล็กกว่าทั้งเอกสาร', async () => {
    const first = await appendBlocks([], paragraphBlocks(['หนึ่ง', 'สอง', 'สาม']));
    const second = await appendBlocks([first!.update], paragraphBlocks(['สี่']));

    expect(second).not.toBeNull();

    // ⚠️ ถ้าเขียนทับทั้ง fragment แทนที่จะทำ diff ค่านี้จะโตพอ ๆ กับของเดิม
    //    และ client ที่มีเนื้อหาอยู่แล้วจะเห็นข้อความซ้ำสองรอบ
    expect(second!.update.length).toBeLessThan(first!.update.length);

    const { types, text } = await inspect([first!.update, second!.update]);
    expect(types).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(text).toBe('หนึ่งสองสามสี่');
  });

  it('เขียนซ้ำหลายรอบได้ ไม่ถูก Yjs ทิ้งเงียบ ๆ', async () => {
    // ─────────────────────────────────────────────────────────────────
    //  ⚠️ ฝั่ง .NET เจอบั๊กนี้: ถ้าใช้ clientID เดิมซ้ำ item รอบใหม่จะได้
    //     (clientID, clock) ชุดเดิมกับรอบก่อน แล้ว Yjs มองว่า "รู้จักแล้ว"
    //     ทิ้งทั้ง update เงียบ ๆ อาการคือเขียนสำเร็จทุกครั้ง (HTTP 200,
    //     seq เดินหน้า) แต่มีแค่รอบแรกที่ปรากฏจริง
    //
    //     ที่นี่ Y.Doc ใหม่ทุกครั้งได้ clientID สุ่มของมันเอง แต่ยังต้องเทสอยู่ดี
    //     เพราะเป็นความผิดพลาดที่มองไม่เห็นเลยถ้าไม่นับจำนวนบล็อก
    // ─────────────────────────────────────────────────────────────────
    const updates: Uint8Array[] = [];

    for (const word of ['หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า']) {
      const written = await appendBlocks(updates, paragraphBlocks([word]));
      expect(written, `เขียน "${word}" ไม่สำเร็จ`).not.toBeNull();
      updates.push(written!.update);
    }

    const { types, text } = await inspect(updates);
    expect(types).toHaveLength(5);
    expect(text).toBe('หนึ่งสองสามสี่ห้า');
  });

  it('markdown ที่มี mark (หนา/เอียง/ลิงก์) ไม่ทำให้ข้อความหาย', async () => {
    // ⚠️ นี่คือเคสที่ check() จับไม่ได้ — mark ที่ schema ไม่รู้จักทำให้
    //    y-prosemirror ลบข้อความช่วงนั้นทิ้งโดยที่โครงยังถูกต้อง
    const blocks = await markdownToBlocks(
      'ข้อความ **หนา** และ *เอียง* และ ~~ขีดฆ่า~~ และ `โค้ด` และ [ลิงก์](https://example.com)',
    );
    const written = await appendBlocks([], blocks);

    const { text } = await inspect([written!.update]);

    for (const fragment of ['ข้อความ', 'หนา', 'เอียง', 'ขีดฆ่า', 'โค้ด', 'ลิงก์']) {
      expect(text, `"${fragment}" หายไป`).toContain(fragment);
    }
  });

  it('ลิสต์ซ้อนชั้นเขียนได้และรูปร่างถูก', async () => {
    // blockGroup ของลูกต้องอยู่ "ข้าง ๆ" เนื้อหา ไม่ใช่ข้างใน และห้ามว่าง
    const blocks = await markdownToBlocks('- พ่อ\n  - ลูก\n    - หลาน');
    const written = await appendBlocks([], blocks);

    const { text } = await inspect([written!.update]);
    expect(text).toContain('พ่อ');
    expect(text).toContain('ลูก');
    expect(text).toContain('หลาน');
  });

  it('ตารางและรูปเขียนลง Y.Doc ได้ รูปร่างผ่าน schema และข้อความในเซลล์ไม่หาย', async () => {
    // ⚠️ node.check() อย่างเดียวไม่พอ (ดูหัวไฟล์) — ต้อง assert ข้อความด้วย
    const blocks = await markdownToBlocks(
      '| ชื่อ | ค่า |\n| --- | --- |\n| หนึ่ง | 1 |\n\n![รูป](https://example.com/a.png)',
    );
    const written = await appendBlocks([], blocks);

    expect(written).not.toBeNull();

    const { types, text } = await inspect([written!.update]);
    expect(types).toEqual(['table', 'image']);
    for (const cell of ['ชื่อ', 'ค่า', 'หนึ่ง', '1']) {
      expect(text, `"${cell}" หายไป`).toContain(cell);
    }
  });

  it('บล็อกว่าง → ไม่เขียนอะไรเลย', async () => {
    expect(await appendBlocks([], [])).toBeNull();
  });
});

describe('เขียนทับทั้งเอกสาร', () => {
  it('ของเดิมหายหมด เหลือเฉพาะชุดใหม่ และรูปร่างผ่าน schema', async () => {
    const first = await appendBlocks([], paragraphBlocks(['ของเดิมหนึ่ง', 'ของเดิมสอง']));
    const replaced = await replaceBlocks([first!.update], await markdownToBlocks('# ใหม่\n\nเนื้อหาใหม่'));

    expect(replaced).not.toBeNull();

    const { types, text } = await inspect([first!.update, replaced!.update]);
    expect(types).toEqual(['heading', 'paragraph']);
    expect(text).toContain('ใหม่');
    expect(text).not.toContain('ของเดิมหนึ่ง');
    expect(text).not.toContain('ของเดิมสอง');
  });

  it('เอกสารว่าง → เท่ากับเขียนครั้งแรก', async () => {
    const written = await replaceBlocks([], paragraphBlocks(['เดียว']));

    expect(written).not.toBeNull();
    expect(await readPlainText([written!.update])).toBe('เดียว');
  });

  it('ยังเป็น delta — client ที่มีของเดิมรวม update แล้วเห็นตรงกับคนโหลดใหม่', async () => {
    // ⚠️ จุดที่พังได้ของ replace: ถ้าไปล้าง fragment แบบไม่ผ่าน diff ผลรวม
    //    ของ (ของเดิม + update ใหม่) กับ (update ใหม่ที่ประกอบบนเอกสารเปล่า)
    //    จะไม่ตรงกัน แล้วสอง client เห็นเนื้อหาคนละแบบ
    const first = await appendBlocks([], paragraphBlocks(['หนึ่ง', 'สอง', 'สาม']));
    const replaced = await replaceBlocks([first!.update], paragraphBlocks(['ใหม่']));

    const merged = await inspect([first!.update, replaced!.update]);
    expect(merged.text).toBe('ใหม่');
  });

  it('บล็อกว่าง → ไม่เขียนอะไรเลย', async () => {
    expect(await replaceBlocks([], [])).toBeNull();
  });
});

describe('อ่านข้อความล้วนกลับ', () => {
  it('คั่นบล็อกด้วย \\n และไม่มี marker ของ markdown', async () => {
    // ⚠️ ต้องตรงกับ blocksToPlainText() ฝั่งเว็บ — ทั้งสองเขียนคอลัมน์เดียวกัน
    //    ถ้ารูปแบบต่างกัน ค่าจะสลับไปมาทุกครั้งที่มีคนเปิดหน้า
    const blocks = await markdownToBlocks('# หัวข้อ\n\nย่อหน้า\n\n- รายการ');
    const written = await appendBlocks([], blocks);

    expect(await readPlainText([written!.update])).toBe('หัวข้อ\nย่อหน้า\nรายการ');
  });

  it('เก็บซอร์สของบล็อกโค้ดไว้ ไม่ตัดทิ้ง', async () => {
    // ไม่งั้น AI อ่านผังงานที่ตัวเองเขียนกลับมาไม่ได้ แล้วแก้ไขมันไม่ได้เลย
    const written = await appendBlocks([], await markdownToBlocks('```mermaid\ngraph TD;\nA-->B;\n```'));

    expect(await readPlainText([written!.update])).toContain('A-->B;');
  });

  it('เอกสารว่าง → สตริงว่าง ไม่ throw', async () => {
    expect(await readPlainText([])).toBe('');
  });

  it('ลิสต์ซ้อนชั้น: ลูกตามหลังพ่อ', async () => {
    const written = await appendBlocks([], await markdownToBlocks('- พ่อ\n  - ลูก'));

    expect(await readPlainText([written!.update])).toBe('พ่อ\nลูก');
  });

  it('ตาราง: แถวละบรรทัด เซลล์คั่นช่องว่าง — ตัวสกัดทั้งสองให้ผลตรงกัน', async () => {
    // ⚠️ readPlainText (จาก ProseMirror) กับ blocksToPlainText (จาก JSON) เขียน
    //    คอลัมน์ body_text เดียวกันคนละจังหวะ — และฝั่งเว็บมี tableText อีกตัว
    //    ที่ต้องตรงตามกฎนี้ (PageEditor.tsx) ถ้าเพี้ยนกันผลค้นหาจะไม่คงที่
    const md = '| ชื่อ | ค่า |\n| --- | --- |\n| หนึ่ง | 1 |\n| สอง | 2 |';
    const blocks = await markdownToBlocks(md);
    const written = await appendBlocks([], blocks);

    const expected = 'ชื่อ ค่า\nหนึ่ง 1\nสอง 2';
    expect(blocksToPlainText(blocks)).toBe(expected);
    expect(await readPlainText([written!.update])).toBe(expected);
  });
});
