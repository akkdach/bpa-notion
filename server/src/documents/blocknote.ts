// ═══════════════════════════════════════════════════════════════════════════
//  BlockNote + Yjs ฝั่งเซิร์ฟเวอร์
//
//  ── นี่คือจุดที่การย้ายมา Node ได้กำไรมากที่สุด ────────────────────────────
//  ฝั่ง .NET ต้องเขียนสามอย่างนี้เองทั้งหมด:
//
//    · BlockNoteWriter.cs      339 บรรทัด — ประกอบ Yjs XML ด้วยมือผ่าน YDotNet
//    · MarkdownToBlockNote.cs  449 บรรทัด — parser markdown ที่เขียนเอง
//    · verify-blocknote-append.mjs — สคริปต์ที่มีอยู่เพื่อ "พิสูจน์ว่ารูปร่างที่
//      เราประกอบเองตรงกับ schema จริงของ BlockNote" เพราะไม่มีอะไรอื่นตรวจให้
//
//  ที่นี่ทั้งสามอย่างหายไป — เราเรียก parser และ schema ของ BlockNote ตัวจริง
//  ตัวเดียวกับที่เบราว์เซอร์ใช้ คำถาม "รูปร่างที่เราสร้างตรงกับที่ BlockNote
//  คาดหวังไหม" จึงไม่มีอยู่อีกต่อไป มันเป็นรูปร่างเดียวกันโดยนิยาม
//
//  ⚠️ คำเตือนทั้งหมดใน BlockNoteWriter.cs ก็หายไปพร้อมกัน (clientID ต้องต่ำกว่า
//     2^32 · blockGroup ต้องมีตัวเดียวที่ระดับบนสุด · mark ที่ schema ไม่รู้จัก
//     ทำให้ข้อความหายเงียบ ๆ · blockGroup ว่างถูก y-prosemirror ลบทิ้ง)
//     — ไม่ใช่เพราะมันไม่จริงแล้ว แต่เพราะไม่มีโค้ดของเราที่ทำผิดได้อีก
// ═══════════════════════════════════════════════════════════════════════════

import type { Node as PmNode, Schema as PmSchema } from 'prosemirror-model';
import * as Y from 'yjs';

/** ชื่อ root fragment — ต้องตรงกับ PageEditor.tsx ฝั่งเว็บเป๊ะ ๆ */
export const FRAGMENT_NAME = 'blocknote';

/** โครงบล็อกของ BlockNote — ใช้ชนิดหลวม ๆ เพราะเราแค่ส่งต่อ ไม่ได้ตีความ */
export interface Block {
  id?: string;
  type: string;
  content?: unknown;
  children?: Block[];
}

// ═══════════════════════════════════════════════════════════════════════════
//  DOM shim
//
//  ⚠️ @blocknote/core แปลง markdown โดยผ่าน HTML แล้ว parse ด้วย DOM จริง
//     (ProseMirror.DOMParser) ใน Node จึงต้องมี document ให้มันใช้
//
//  ⚠️ ต้องติดตั้ง "ก่อน" import @blocknote/core — ESM hoist static import ขึ้น
//     บนสุดเสมอ จึงต้องใช้ dynamic import ตรงนี้ ไม่ใช่ import ธรรมดา
//
//  linkedom ถูกเลือกเพราะเป็น JS ล้วน ไม่มี native binding และเบากว่า jsdom มาก
//  — เราต้องการแค่ตัว parse HTML ไม่ได้ต้องการ browser จำลองทั้งตัว
// ═══════════════════════════════════════════════════════════════════════════
async function installDom(): Promise<void> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g['document'] !== undefined) return;

  const { parseHTML } = await import('linkedom');
  const html = () => parseHTML('<!doctype html><html><body></body></html>');
  const { window } = html();

  for (const key of ['document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'navigator']) {
    g[key] ??= (window as unknown as Record<string, unknown>)[key];
  }
  g['window'] ??= window;

  // ⚠️ linkedom ไม่มี document.implementation ซึ่ง prosemirror-model เรียกใช้
  //    ตอน parse HTML — ขาดตัวนี้แล้ว markdown ทุกชิ้นจะพังด้วย error ที่ชี้
  //    ไปคนละที่ ("Cannot read properties of undefined (reading 'createHTMLDocument')")
  const doc = g['document'] as unknown as { implementation?: unknown };
  doc.implementation ??= { createHTMLDocument: () => html().document };
}

interface BlockNoteModule {
  BlockNoteEditor: {
    create(options: { _headless: true; initialContent?: Block[] }): HeadlessEditor;
  };
}

interface HeadlessEditor {
  document: Block[];
  pmSchema: PmSchema;
  prosemirrorState: { doc: PmNode };
  tryParseMarkdownToBlocks(markdown: string): Promise<Block[]>;
}

let loaded: Promise<BlockNoteModule> | undefined;

/**
 * โหลด BlockNote ครั้งเดียวต่อ process แบบ lazy
 *
 * ไม่โหลดตอนบูตเพราะ DOM shim + BlockNote รวมกันหลายเมกะไบต์ และ request
 * ส่วนใหญ่ไม่ได้แตะเนื้อหาเลย — bootstrap/append เป็นทางที่ AI ใช้เป็นหลัก
 */
async function blocknote(): Promise<BlockNoteModule> {
  loaded ??= (async () => {
    await installDom();
    return (await import('@blocknote/core')) as unknown as BlockNoteModule;
  })();

  return loaded;
}

const editorWith = async (content?: Block[]): Promise<HeadlessEditor> => {
  const bn = await blocknote();
  return bn.BlockNoteEditor.create(
    content === undefined ? { _headless: true } : { _headless: true, initialContent: content },
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  markdown → บล็อก
// ═══════════════════════════════════════════════════════════════════════════

/**
 * แปลง markdown เป็นบล็อกด้วย parser ของ BlockNote เอง
 *
 * ⚠️ "lossy" ตามชื่อของมัน — ของที่ schema ไม่รองรับ (ตาราง รูป HTML ดิบ)
 *    ถูกลดรูป ไม่ใช่ทำให้พัง ซึ่งเป็นพฤติกรรมเดียวกับที่ฝั่ง .NET ตั้งใจไว้
 *    (ที่นั่นต้องเขียนตัวลดรูปเองพร้อมรายงาน warnings)
 */
export async function markdownToBlocks(markdown: string): Promise<Block[]> {
  const editor = await editorWith();
  const blocks = await editor.tryParseMarkdownToBlocks(markdown);
  restoreCodeBlockNewlines(markdown, blocks);
  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️ newline ในบล็อกโค้ดหายเมื่อ parse บน linkedom
//
//  ทาง markdown → HTML → DOM ของ BlockNote พึ่ง preserveWhitespace ของ
//  ProseMirror ซึ่งทำงานถูกบนเบราว์เซอร์จริง แต่บน DOM shim ทุกบรรทัดใน
//  <pre><code> ถูกยุบเป็นช่องว่าง — mermaid หลายบรรทัดจึงกลายเป็นบรรทัดเดียว
//  แล้ววาดไม่ออก ("ไวยากรณ์ mermaid ไม่ถูกต้อง")
//
//  แก้ที่ปลายทาง: ดึงเนื้อดิบของ fence จากซอร์ส markdown ตรง ๆ มาแทนข้อความ
//  ของ codeBlock ตัวที่ i ตามลำดับ — ทำเฉพาะเมื่อจำนวน fence ตรงกับจำนวน
//  codeBlock เท่านั้น (โค้ดจาก indented block หรือใน blockquote ทำให้ลำดับ
//  เพี้ยนได้ ซึ่งกรณีนั้นปล่อยผลของ parser ไว้ตามเดิมดีกว่าจับคู่ผิดตัว)
// ═══════════════════════════════════════════════════════════════════════════
function restoreCodeBlockNewlines(markdown: string, blocks: Block[]): void {
  const fences = extractFences(markdown);
  if (fences.length === 0) return;

  const codeBlocks: Block[] = [];
  const walk = (list: Block[]): void => {
    for (const block of list) {
      if (block.type === 'codeBlock') codeBlocks.push(block);
      if (block.children) walk(block.children);
    }
  };
  walk(blocks);

  if (codeBlocks.length !== fences.length) return;

  for (const [i, block] of codeBlocks.entries()) {
    block.content = [{ type: 'text', text: fences[i]!, styles: {} }];
  }
}

/** เนื้อดิบของ fenced code block (``` หรือ ~~~) เรียงตามลำดับที่พบ */
function extractFences(markdown: string): string[] {
  const fences: string[] = [];
  let open: string | null = null;
  let buffer: string[] = [];

  for (const line of markdown.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);

    if (open === null) {
      if (match) {
        open = match[1]!;
        buffer = [];
      }
    } else if (match && match[1]![0] === open[0] && match[1]!.length >= open.length) {
      fences.push(buffer.join('\n'));
      open = null;
    } else {
      buffer.push(line);
    }
  }

  // fence ที่ไม่ได้ปิด — parser ก็ยังนับส่วนที่เหลือเป็นโค้ดเหมือนกัน
  if (open !== null && buffer.length > 0) fences.push(buffer.join('\n'));

  return fences;
}

/** ย่อหน้าล้วน — ไม่ผ่าน markdown parser เพื่อไม่ให้ `#` หรือ `-` ถูกตีความ */
export function paragraphBlocks(paragraphs: readonly string[]): Block[] {
  return paragraphs.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text, styles: {} }],
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
//  เขียนลง Y.Doc
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ต่อบล็อกเข้าท้ายเอกสาร แล้วคืน "ส่วนต่าง" ที่ต้อง append เข้า log
 *
 * ⚠️ ต้องเป็นส่วนต่าง ไม่ใช่เอกสารทั้งก้อน — update ของ Yjs รวมกับสิ่งที่
 *    client อื่นเขียนพร้อมกันได้ก็ต่อเมื่อมันเป็น delta
 *
 * ⚠️ prosemirrorToYXmlFragment เรียก updateYFragment ข้างใน ซึ่งเทียบโครงเดิม
 *    กับโครงใหม่แล้วแตะเฉพาะส่วนที่ต่าง — ไม่ได้เขียนทับทั้ง fragment
 *    (พิสูจน์แล้ว: ต่อย่อหน้าเดียวเข้าเอกสาร 3 ย่อหน้าได้ diff ~235 ไบต์
 *     เทียบกับ ~760 ไบต์ของทั้งเอกสาร และ client ที่มีของเดิมอยู่แล้วเห็นครบ)
 */
export async function appendBlocks(
  existingUpdates: readonly Uint8Array[],
  blocks: Block[],
): Promise<{ update: Uint8Array; clientId: number } | null> {
  if (blocks.length === 0) return null;

  const { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } = await import('y-prosemirror');

  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(FRAGMENT_NAME);

  for (const update of existingUpdates) {
    if (update.length > 0) Y.applyUpdate(doc, update);
  }

  const before = Y.encodeStateVector(doc);
  const additions = (await editorWith(blocks)).prosemirrorState.doc;

  if (fragment.length === 0) {
    // เอกสารว่าง — หน้าที่สร้างผ่าน API แล้วยังไม่มีใครเปิดในเบราว์เซอร์
    // เป็นทางปกติ ไม่ใช่ทางหลบ
    doc.transact(() => prosemirrorToYXmlFragment(additions, fragment));
  } else {
    const schema = (await editorWith()).pmSchema;
    const existing = yXmlFragmentToProseMirrorRootNode(fragment, schema);

    // ─────────────────────────────────────────────────────────────────
    //  ⚠️ doc ของ BlockNote มี blockGroup ตัวเดียวเป๊ะที่ระดับบนสุด
    //     การต่อบล็อกจึงคือการต่อ "ลูกของ blockGroup" ไม่ใช่ต่อที่ระดับ doc
    //     ถ้าต่อผิดชั้น y-prosemirror จะ throw นอก try/catch แล้ว editor
    //     ไม่ render เลยทุกเครื่อง
    // ─────────────────────────────────────────────────────────────────
    const existingGroup = existing.firstChild;
    const newGroup = additions.firstChild;
    if (!existingGroup || !newGroup) return null;

    const merged = existing.type.create(
      existing.attrs,
      existingGroup.type.create(existingGroup.attrs, existingGroup.content.append(newGroup.content)),
    );

    doc.transact(() => prosemirrorToYXmlFragment(merged, fragment));
  }

  const update = Y.encodeStateAsUpdate(doc, before);

  return { update, clientId: doc.clientID };
}

/**
 * เขียนทับเนื้อหาทั้งเอกสารด้วยบล็อกชุดใหม่ แล้วคืน "ส่วนต่าง" แบบเดียวกับ
 * appendBlocks
 *
 * ⚠️ ไม่ได้ล้างแล้วเขียนใหม่ — ส่งเอกสารใหม่เข้า updateYFragment ตรง ๆ ให้มัน
 *    diff กับโครงเดิม จึงยังเป็น delta ที่ client อื่นรวมได้ และส่วนที่เหมือน
 *    ของเดิม (เช่นหัวเรื่องที่ไม่เปลี่ยน) ไม่ถูกแตะเลย
 *
 * ⚠️ ประวัติใน update log ยังอยู่ครบ — การเขียนทับกู้คืนได้ในระดับข้อมูล
 *    แต่ยังไม่มีเครื่องมือ restore อัตโนมัติ ผู้เรียกต้องถือว่านี่คือการลบ
 */
export async function replaceBlocks(
  existingUpdates: readonly Uint8Array[],
  blocks: Block[],
): Promise<{ update: Uint8Array; clientId: number } | null> {
  if (blocks.length === 0) return null;

  const { prosemirrorToYXmlFragment } = await import('y-prosemirror');

  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(FRAGMENT_NAME);

  for (const update of existingUpdates) {
    if (update.length > 0) Y.applyUpdate(doc, update);
  }

  const before = Y.encodeStateVector(doc);
  const replacement = (await editorWith(blocks)).prosemirrorState.doc;

  doc.transact(() => prosemirrorToYXmlFragment(replacement, fragment));

  const update = Y.encodeStateAsUpdate(doc, before);
  if (update.length === 0) return null;

  return { update, clientId: doc.clientID };
}

// ═══════════════════════════════════════════════════════════════════════════
//  อ่านเนื้อหาเป็นข้อความล้วน
//
//  ⚠️ ต้องให้ผลตรงกับ blocksToPlainText() ใน web/src/features/editor/
//     components/PageEditor.tsx เป๊ะ ๆ
//
//     ทั้งสองฝั่งเขียนลงคอลัมน์เดียวกัน (page_searches.body_text) ถ้ารูปแบบ
//     ต่างกัน ค่านั้นจะสลับไปมาทุกครั้งที่มีคนเปิดหน้า แล้วผลค้นหาจะไม่คงที่
//
//     กฎคือ: ข้อความของแต่ละบล็อก คั่นด้วย \n · ลูกหลานตามหลังพ่อ · บล็อกที่
//     ไม่มีข้อความถูกข้าม · ไม่มี marker ของ markdown (# หรือ -)
//
//  ⚠️ ซอร์สของบล็อกโค้ดถูกเก็บด้วย ไม่ตัดทิ้ง — ไม่งั้น AI จะอ่านผังงาน
//     ที่ตัวเองเขียนกลับมาไม่ได้ แล้วแก้ไขมันไม่ได้เลย
// ═══════════════════════════════════════════════════════════════════════════
export async function readPlainText(existingUpdates: readonly Uint8Array[]): Promise<string> {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(FRAGMENT_NAME);

  for (const update of existingUpdates) {
    if (update.length > 0) Y.applyUpdate(doc, update);
  }

  if (fragment.length === 0) return '';

  const { yXmlFragmentToProseMirrorRootNode } = await import('y-prosemirror');
  const schema = (await editorWith()).pmSchema;

  return collectText(yXmlFragmentToProseMirrorRootNode(fragment, schema));
}

/**
 * เดินโครง blockGroup > blockContainer > (เนื้อหา) [+ blockGroup ของลูก]
 * แล้วเก็บข้อความทีละบล็อก
 */
function collectText(node: PmNode): string {
  const lines: string[] = [];

  const walkGroup = (group: PmNode): void => {
    group.forEach((container) => {
      const content = container.firstChild;
      if (content && content.type.name !== 'blockGroup') {
        if (content.type.name === 'table') {
          // ⚠️ textContent ของทั้งตารางคือทุกเซลล์ติดกันไม่มีตัวคั่น ("ชื่อค่าหนึ่ง1")
          //    ต้องเดินทีละแถวเองตามกฎตาราง (ดู tableRowLines)
          lines.push(...tableRowLines(content));
        } else {
          const text = content.textContent;
          if (text.length > 0) lines.push(text);
        }
      }

      // blockGroup ของลูกอยู่ "ข้าง ๆ" เนื้อหา ไม่ใช่ข้างใน
      container.forEach((child) => {
        if (child.type.name === 'blockGroup') walkGroup(child);
      });
    });
  };

  node.forEach((child) => {
    if (child.type.name === 'blockGroup') walkGroup(child);
  });

  return lines.join('\n');
}

/**
 * กฎข้อความของตาราง — ต้องเหมือนกันทุกตัวสกัด (ที่นี่ 2 ตัว + ฝั่งเว็บ 1 ตัว):
 * แถวละบรรทัด · ข้อความเซลล์ในแถวคั่นด้วยช่องว่างเดียว · เซลล์/แถวว่างถูกข้าม
 *
 * ⚠️ ถ้ารูปแบบสามที่นี้ไม่ตรงกัน body_text ใน index ค้นหาจะสลับไปมาทุกครั้ง
 *    ที่มีคนเปิดหน้า — ปัญหาเดียวกับกฎ "ไม่มี marker" ของ readPlainText
 */
function tableRowLines(table: PmNode): string[] {
  const rows: string[] = [];

  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const text = cell.textContent;
      if (text.length > 0) cells.push(text);
    });
    if (cells.length > 0) rows.push(cells.join(' '));
  });

  return rows;
}

/** แบบเดียวกับ tableRowLines แต่เดินจากโครง JSON ของ BlockNote (tableContent) */
function tableContentLines(content: unknown): string[] {
  if (content === null || typeof content !== 'object') return [];
  const rows = (content as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];

  const lines: string[] = [];
  for (const row of rows) {
    const cells = (row as { cells?: unknown }).cells;
    if (!Array.isArray(cells)) continue;

    const texts = cells
      // เซลล์เป็นได้ทั้ง {type:'tableCell', content:[...]} และ inline array เปล่า ๆ
      .map((cell) =>
        Array.isArray(cell) ? extractText(cell) : extractText((cell as { content?: unknown })?.content),
      )
      .filter((text) => text.length > 0);
    if (texts.length > 0) lines.push(texts.join(' '));
  }

  return lines;
}

/** ข้อความของบล็อกที่จะเขียน — ใช้ต่อท้าย projection ให้ค้นเจอทันที */
export function blocksToPlainText(blocks: readonly Block[]): string {
  const lines: string[] = [];

  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      if (block.type === 'table') {
        lines.push(...tableContentLines(block.content));
      } else {
        const text = extractText(block.content);
        if (text.length > 0) lines.push(text);
      }
      if (block.children) walk(block.children);
    }
  };

  walk(blocks);
  return lines.join('\n');
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (item === null || typeof item !== 'object') return '';
      const record = item as { text?: unknown; content?: unknown };
      return typeof record.text === 'string' ? record.text : extractText(record.content);
    })
    .join('');
}
