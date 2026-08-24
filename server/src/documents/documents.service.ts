import { Injectable, Logger } from '@nestjs/common';

import {
  appendBlocks,
  blocksToPlainText,
  markdownToBlocks,
  paragraphBlocks,
  replaceBlocks,
  type Block,
} from './blocknote.js';
import { DocRepository } from './doc.repository.js';
import type {
  AppendResultDto,
  BacklinkDto,
  DocumentBootstrapDto,
  PageContentDto,
  ProjectionInput,
  SnapshotResultDto,
} from './documents.schema.js';
import { requireUserId, requireWorkspaceId } from '../common/request-context.js';
import { err, ok, type Result, type VoidResult, okVoid } from '../common/result.js';
import { canEdit } from '../domain/roles.js';
import { PageRepository } from '../pages/page.repository.js';
import { PermissionService } from '../pages/permission.service.js';

// ═══════════════════════════════════════════════════════════════════════════
//  DocumentService — เนื้อหาของหน้า (Yjs)
// ═══════════════════════════════════════════════════════════════════════════

/** compact เมื่อ update สะสมเกินนี้ */
const COMPACT_THRESHOLD = 300;

/**
 * snapshot ที่เล็กกว่ารุ่นก่อนเกินครึ่ง = น่าสงสัยว่าข้อมูลหาย
 * ยังเก็บไว้ (การลบเนื้อหาจำนวนมากก็ทำให้เล็กลงได้จริง) แต่ไม่ prune
 */
const SUSPICIOUS_SHRINK_RATIO = 0.5;

/**
 * จำนวน backlink สูงสุดที่คืนกลับ
 *
 * มีเพดานเพราะแต่ละแถวต้องเช็คสิทธิ์ทีละหน้า — หน้าที่ถูกอ้างถึงจาก 5,000 ที่
 * (เช่นหน้าสารบัญกลาง) จะกลายเป็น 5,000 permission check ต่อการเปิดหนึ่งครั้ง
 */
const BACKLINK_LIMIT = 50;

/**
 * เพดานย่อหน้า/บล็อกต่อการเรียกหนึ่งครั้ง
 *
 * การเขียนทีละมาก ๆ ทำให้ update ก้อนเดียวใหญ่ และถ้ารูปร่างผิดก็เสียหายกว้าง
 * AI ที่อยากเขียนยาวกว่านี้ควรเรียกซ้ำ — ระหว่างนั้นมีจังหวะให้เห็นผลก่อน
 */
const MAX_PARAGRAPHS_PER_CALL = 50;
const MAX_BLOCKS_PER_CALL = 200;

/** เพดานของ body ที่เก็บลง index ค้นหา — เอกสารยาวมากทำให้ bigram index โตเร็วโดยผลค้นหาไม่ดีขึ้น */
const MAX_PROJECTION_LENGTH = 100_000;

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly docs: DocRepository,
    private readonly pages: PageRepository,
    private readonly permissions: PermissionService,
  ) {}

  async bootstrap(pageId: string): Promise<Result<DocumentBootstrapDto>> {
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;

    const state = await this.docs.readState(pageId);
    const stats = await this.docs.stats(pageId);

    return ok({
      pageId,
      role,
      frames: buildFrames(state.snapshot, state.updates),
      headSeq: state.headSeq,
      snapshotUpToSeq: state.snapshotUpToSeq,
      updatesSinceSnapshot: stats.updatesSinceSnapshot,
      shouldCompact: stats.updatesSinceSnapshot > COMPACT_THRESHOLD,
    });
  }

  async appendUpdate(
    pageId: string,
    update: Uint8Array,
    yClientId: number | null,
  ): Promise<Result<{ seq: number; shouldCompact: boolean }>> {
    if (update.length === 0) return err.validation('update ว่าง', 'empty_update');

    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;
    if (!canEdit(role)) return NO_EDIT_PERMISSION;

    const editorId = requireUserId();

    const seq = await this.docs.appendUpdate({
      workspaceId: requireWorkspaceId(),
      pageId,
      update,
      yClientId,
      authorUserId: editorId,
    });

    // ⚠️ ทางนี้คือทางเดียวที่เนื้อหาเปลี่ยนจริง — ทั้งการพิมพ์ในเบราว์เซอร์และ
    //    การเขียนผ่าน MCP (writeBlocks เรียกเมธอดนี้) จึงเป็นที่ที่ถูกต้องสำหรับ
    //    บันทึกว่าใครแก้ล่าสุด
    //
    //    เดิมไม่มีบรรทัดนี้ แล้วไปอาศัย updateTitleSilently ในทาง projection แทน
    //    ผลคือ "คนแรกที่เปิดหน้าที่ AI เขียน" กลายเป็นคนแก้ล่าสุด ทั้งที่ไม่ได้พิมพ์
    await this.pages.markEdited(pageId, editorId);

    const stats = await this.docs.stats(pageId);

    return ok({ seq, shouldCompact: stats.updatesSinceSnapshot > COMPACT_THRESHOLD });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Snapshot — client เป็นคนสร้าง เพราะเซิร์ฟเวอร์ merge CRDT เองไม่ได้
  //
  //  ⚠️ นี่คือ trust boundary จุดเดียวในระบบที่ client เขียนข้อมูลที่เราตรวจสอบ
  //     เนื้อหาไม่ได้ ทุกด่านข้างล่างมีไว้เพื่อให้ความผิดพลาด "กู้คืนได้"
  //     ไม่ใช่ "เกิดขึ้นไม่ได้"
  // ═══════════════════════════════════════════════════════════════════════
  async saveSnapshot(
    pageId: string,
    snapshot: Uint8Array,
    upToSeq: number,
  ): Promise<Result<SnapshotResultDto>> {
    // ─── ด่าน 1: ต้องมีสิทธิ์แก้ ─────────────────────────────────────────
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;
    if (!canEdit(role)) return NO_EDIT_PERMISSION;

    if (snapshot.length === 0) return err.validation('snapshot ว่าง', 'empty_snapshot');

    // ─── ด่าน 2: upToSeq ต้องไม่ล้ำหน้าความจริง ─────────────────────────
    const headSeq = await this.docs.headSeq(pageId);

    if (upToSeq > headSeq) {
      this.logger.warn(`ปฏิเสธ snapshot ของหน้า ${pageId}: upToSeq ${upToSeq} > headSeq ${headSeq}`);
      return err.validation(`upToSeq (${upToSeq}) เกิน update ล่าสุด (${headSeq})`, 'snapshot_ahead');
    }

    // ─── ด่าน 3: มี snapshot ที่จุดนี้อยู่แล้ว ────────────────────────────
    //
    //  เกิดขึ้นได้จริงเมื่อสอง client ตัดสินใจ compact ที่ seq เดียวกันพร้อมกัน
    //  — ไม่ใช่ความผิดพลาด แค่ทำซ้ำ ต้องดักที่นี่ ไม่ปล่อยให้ไปชน unique index
    //  แล้วกลายเป็น 500 (client ที่ได้ 409 แค่ข้ามไป)
    const latest = await this.docs.latestSnapshot(pageId);

    if (latest && latest.upToSeq === upToSeq) {
      return err.conflict(
        `มี snapshot ที่ seq ${upToSeq} อยู่แล้ว — client อื่น compact ไปก่อนแล้ว`,
        'snapshot_exists',
      );
    }

    // ─── ด่าน 4: ขนาดหดผิดปกติ = เก็บแต่ไม่ prune ───────────────────────
    //
    //  ⚠️ ดีไซน์ "เก็บไว้แต่ไม่ prune" อย่างเดียวไม่พอ และเทสฝั่ง .NET จับได้:
    //     bootstrap หยิบ snapshot ที่ up_to_seq สูงสุดมาเสิร์ฟ แล้วข้าม update
    //     ที่เก่ากว่าไปหมด ผลคือ update ยังอยู่ในฐานครบ แต่ผู้ใช้เห็นหน้าว่าง
    //
    //  ทางแก้: snapshot แรกที่หดแรงถูกเก็บแบบ "ยังไม่เชื่อ" (ไม่ใช้เสิร์ฟ ไม่
    //  prune) ถ้าตัวถัดไปขนาดใกล้เคียงกัน แปลว่าเนื้อหาหดจริง (ผู้ใช้ลบเยอะ)
    //  ไม่ใช่ client ตัวเดียวส่งของไม่ครบ — ตอนนั้นค่อยเชื่อ
    const shrankSharply = latest !== undefined && snapshot.length < latest.byteSize * SUSPICIOUS_SHRINK_RATIO;

    let trusted = true;

    if (shrankSharply) {
      const witness = await this.docs.latestUntrustedSnapshot(pageId);
      trusted = witness !== undefined && isSimilarSize(snapshot.length, witness.byteSize);

      if (trusted) {
        this.logger.log(
          `หน้า ${pageId}: snapshot ที่หดตัวได้รับการยืนยันจากตัวก่อนหน้า ` +
            `(${snapshot.length} ไบต์ เทียบกับพยาน ${witness!.byteSize}) — เชื่อว่าเนื้อหาถูกลบจริง`,
        );
      } else {
        this.logger.warn(
          `หน้า ${pageId}: snapshot เล็กลงผิดปกติ (${snapshot.length} จาก ${latest.byteSize} ไบต์) — ` +
            'เก็บไว้แบบยังไม่เชื่อ ไม่ใช้เสิร์ฟและไม่ prune รอ snapshot ตัวถัดไปมายืนยัน',
        );
      }
    }

    const pruned = await this.docs.saveSnapshotAndPrune(
      {
        workspaceId: requireWorkspaceId(),
        pageId,
        snapshot,
        upToSeq,
        isTrusted: trusted,
        createdBy: requireUserId(),
      },
      trusted,
    );

    return ok({ upToSeq, byteSize: snapshot.length, prunedUpdates: pruned, pruneSkipped: !trusted });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Projection — client แกะ plain text จาก Y.Doc แล้วส่งมา
  // ═══════════════════════════════════════════════════════════════════════
  async saveProjection(pageId: string, input: ProjectionInput): Promise<VoidResult> {
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;
    if (!canEdit(role)) return NO_EDIT_PERMISSION;

    const page = await this.pages.get(pageId);
    if (!page) return PAGE_NOT_FOUND;

    const workspaceId = requireWorkspaceId();
    const title = (input.title ?? '').trim();

    // ⚠️ ไม่เขียน activity ที่นี่โดยเจตนา
    //
    //    ทางนี้คือ autosave — เบราว์เซอร์ส่ง projection ทุกครั้งที่ผู้ใช้หยุดพิมพ์
    //    2 วินาที และ title คือ "บรรทัดแรกของเอกสาร" ซึ่งเปลี่ยนไปเรื่อย ๆ ระหว่าง
    //    พิมพ์ประโยคแรก ถ้าบันทึกประวัติทุกครั้ง ฟีดกิจกรรมจะถูกกลบด้วยการเปลี่ยน
    //    ชื่อทีละตัวอักษรจนมองไม่เห็นสิ่งที่ AI ทำ ซึ่งเป็นเหตุผลที่ฟีดมีอยู่
    // ⚠️ ไม่ส่ง userId เข้าไปแล้ว — ดูเหตุผลใน PageRepository.updateTitleSilently
    //    (การ sync ชื่อไม่ใช่การประพันธ์ คนที่แค่เปิดหน้าดูก็ทำให้เกิดได้)
    if (title !== page.title) {
      await this.pages.updateTitleSilently(pageId, title);
    }

    await this.docs.upsertProjection({
      workspaceId,
      pageId,
      accessRootId: page.accessRootId,
      title,
      bodyText: truncate(input.plainText ?? ''),
    });

    // ⚠️ undefined ≠ [] — undefined คือ "client ไม่ได้ส่งช่องนี้มา" ให้คงลิงก์เดิม
    //    ถ้าตีความเป็น [] การ deploy โค้ดใหม่ทับ client เก่าจะล้างลิงก์ของทุกหน้า
    //    ทิ้งทีละหน้าตามที่ผู้ใช้เปิด — ความเสียหายแบบค่อยเป็นค่อยไปที่ไม่มีใคร
    //    สังเกตจนสาย
    if (input.links !== undefined && input.links !== null) {
      await this.docs.replaceLinks(workspaceId, pageId, input.links);
    }

    return okVoid();
  }

  /**
   * อ่านเนื้อหาเป็น plain text
   *
   * ไม่ต้องมีสิทธิ์แก้ แค่เห็นหน้าก็อ่านได้ — ต่างจาก saveProjection ที่ต้อง
   * canEdit เพราะมันเขียน
   */
  async getContent(pageId: string): Promise<Result<PageContentDto>> {
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;

    const page = await this.pages.get(pageId);
    if (!page) return PAGE_NOT_FOUND;

    const projection = await this.docs.getProjection(pageId);

    // ─────────────────────────────────────────────────────────────────────
    //  ไม่มีแถว = ยังไม่เคยมีเบราว์เซอร์เปิดหน้านี้
    //
    //  ต้องบอกให้ต่างจาก "หน้าว่าง" ให้ชัด ไม่งั้นผู้เรียก (โดยเฉพาะ AI) จะสรุป
    //  ว่าหน้านี้ไม่มีเนื้อหาแล้วเขียนทับหรือรายงานผิด
    // ─────────────────────────────────────────────────────────────────────
    if (!projection) {
      return ok({
        id: page.id,
        title: page.title,
        bodyText: '',
        freshness: 'never',
        pageUpdatedAt: page.updatedAt,
        projectionUpdatedAt: null,
      });
    }

    return ok({
      id: page.id,
      // title จาก pages เป็นตัวจริง — projection.title เป็นสำเนาที่อาจล้ากว่า
      title: page.title,
      bodyText: projection.bodyText,
      freshness: 'from_document',
      pageUpdatedAt: page.updatedAt,
      projectionUpdatedAt: projection.updatedAt,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  เขียนต่อท้ายเอกสาร — จุดเดียวที่เซิร์ฟเวอร์เขียน Yjs
  // ═══════════════════════════════════════════════════════════════════════

  async appendParagraphs(pageId: string, paragraphs: readonly string[]): Promise<Result<AppendResultDto>> {
    // ⚠️ ย่อหน้าที่มีขึ้นบรรทัดในตัวจะกลายเป็น "ย่อหน้าเดียวที่มี \n ข้างใน"
    //    ซึ่ง BlockNote ไม่มีโครงรองรับ — ProseMirror text node ไม่เก็บ newline
    //    เป็นอย่างอื่นนอกจากตัวอักษร ผลคือมันจะแสดงติดกันหมด
    //    แตกให้เป็นคนละย่อหน้าเสียตรงนี้ ดีกว่าปล่อยให้ผู้เรียกเดาเอง
    const expanded = paragraphs
      .flatMap((p) => (p ?? '').replaceAll('\r\n', '\n').split('\n'))
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (expanded.length === 0) return err.validation('ไม่มีย่อหน้าให้เขียน', 'no_paragraphs');

    if (expanded.length > MAX_PARAGRAPHS_PER_CALL) {
      return err.validation(
        `เขียนได้ครั้งละไม่เกิน ${MAX_PARAGRAPHS_PER_CALL} ย่อหน้า`,
        'too_many_paragraphs',
      );
    }

    const written = await this.writeBlocks(pageId, paragraphBlocks(expanded));
    if (!written.ok) return written;

    return ok({ seq: written.value, blocks: expanded.length, warnings: [] });
  }

  /**
   * ⚠️ ห้ามส่ง markdown ผ่านทาง appendParagraphs — มันแตกทุกอย่างที่ '\n'
   *    ซึ่งจะฉีกบล็อกโค้ด (และผังงาน mermaid) เป็นชิ้น ๆ
   */
  async appendMarkdown(pageId: string, markdown: string): Promise<Result<AppendResultDto>> {
    const source = (markdown ?? '').replaceAll('\r\n', '\n');

    if (source.trim().length === 0) return err.validation('ไม่มีเนื้อหาให้เขียน', 'no_markdown');

    if (source.length > MAX_PROJECTION_LENGTH) {
      return err.validation(
        `เนื้อหายาวเกิน ${MAX_PROJECTION_LENGTH.toLocaleString()} ตัวอักษร — แบ่งเขียนหลายครั้ง`,
        'markdown_too_long',
      );
    }

    let blocks: Block[];
    try {
      blocks = await markdownToBlocks(source);
    } catch (error) {
      this.logger.error(`แปลง markdown ไม่สำเร็จสำหรับหน้า ${pageId}: ${String(error)}`);
      return err.validation('อ่าน markdown ไม่ออก', 'markdown_parse_failed');
    }

    if (blocks.length === 0) return err.validation('ไม่มีเนื้อหาให้เขียน', 'no_markdown');

    if (blocks.length > MAX_BLOCKS_PER_CALL) {
      return err.validation(`เขียนได้ครั้งละไม่เกิน ${MAX_BLOCKS_PER_CALL} บล็อก`, 'too_many_blocks');
    }

    const written = await this.writeBlocks(pageId, blocks);
    if (!written.ok) return written;

    return ok({ seq: written.value, blocks: blocks.length, warnings: [] });
  }

  /**
   * เขียนทับเนื้อหาทั้งหน้าด้วย markdown ชุดใหม่
   *
   * ⚠️ ทางเดียวใน API ที่ "ลบ" เนื้อหาเดิมได้ — ด่านตรวจเหมือน append ทุกข้อ
   *    และประวัติใน update log ยังอยู่ แต่ไม่มีเครื่องมือ restore ให้ผู้ใช้
   *    ผู้เรียกจึงควรอ่านเนื้อหาปัจจุบันก่อนเสมอ
   */
  async replaceMarkdown(pageId: string, markdown: string): Promise<Result<AppendResultDto>> {
    const source = (markdown ?? '').replaceAll('\r\n', '\n');

    if (source.trim().length === 0) return err.validation('ไม่มีเนื้อหาให้เขียน', 'no_markdown');

    if (source.length > MAX_PROJECTION_LENGTH) {
      return err.validation(
        `เนื้อหายาวเกิน ${MAX_PROJECTION_LENGTH.toLocaleString()} ตัวอักษร — แบ่งเขียนหลายครั้ง`,
        'markdown_too_long',
      );
    }

    let blocks: Block[];
    try {
      blocks = await markdownToBlocks(source);
    } catch (error) {
      this.logger.error(`แปลง markdown ไม่สำเร็จสำหรับหน้า ${pageId}: ${String(error)}`);
      return err.validation('อ่าน markdown ไม่ออก', 'markdown_parse_failed');
    }

    if (blocks.length === 0) return err.validation('ไม่มีเนื้อหาให้เขียน', 'no_markdown');

    if (blocks.length > MAX_BLOCKS_PER_CALL) {
      return err.validation(`เขียนได้ครั้งละไม่เกิน ${MAX_BLOCKS_PER_CALL} บล็อก`, 'too_many_blocks');
    }

    const written = await this.writeBlocks(pageId, blocks, 'replace');
    if (!written.ok) return written;

    return ok({ seq: written.value, blocks: blocks.length, warnings: [] });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ทางเขียนจริง — ใช้ร่วมกันทั้งย่อหน้าและ markdown
  //
  //  รวมไว้ที่เดียวโดยเจตนา: ส่วนที่พังแล้วเจ็บ (สิทธิ์ · อ่านสถานะก่อนเขียน ·
  //  ทำ diff · projection) ต้องมีฉบับเดียว ไม่ใช่สองฉบับที่ค่อย ๆ เพี้ยนจากกัน
  // ═══════════════════════════════════════════════════════════════════════
  private async writeBlocks(
    pageId: string,
    blocks: Block[],
    mode: 'append' | 'replace' = 'append',
  ): Promise<Result<number>> {
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;
    if (!canEdit(role)) return NO_EDIT_PERMISSION;

    const page = await this.pages.get(pageId);
    if (!page) return PAGE_NOT_FOUND;

    // ⚠️ ต้องอ่านสถานะจริงก่อน ไม่ใช่เขียนทับ — เพื่อให้ update ที่ได้รวมกับ
    //    สิ่งที่ client อื่นเขียนพร้อมกันได้ตามปกติของ CRDT
    //    (replace ก็เช่นกัน — มันคือ diff กับโครงเดิม ไม่ใช่การล้าง log)
    const frames = await this.docs.readFrames(pageId);

    let written: { update: Uint8Array; clientId: number } | null;
    try {
      written = mode === 'replace' ? await replaceBlocks(frames, blocks) : await appendBlocks(frames, blocks);
    } catch (error) {
      this.logger.error(`สร้าง Yjs update ไม่สำเร็จสำหรับหน้า ${pageId}: ${String(error)}`);
      return err.unavailable('เขียนเนื้อหาไม่สำเร็จ', 'yjs_write_failed');
    }

    if (!written || written.update.length === 0) {
      return err.unavailable('สร้าง update ได้เป็นค่าว่าง', 'yjs_write_empty');
    }

    const appended = await this.appendUpdate(pageId, written.update, written.clientId);
    if (!appended.ok) return appended;

    // ─────────────────────────────────────────────────────────────────────
    //  อัปเดต projection ให้ค้นเจอทันที
    //
    //  ถ้าไม่ทำ ข้อความที่เพิ่งเขียนจะค้นไม่เจอจนกว่าจะมีคนเปิดหน้านั้นใน
    //  เบราว์เซอร์ — ปัญหาเดียวกับที่ page_searches ไม่ถูก seed ตอนสร้างหน้า
    //
    //  ⚠️ เก็บ "ข้อความล้วน" เท่านั้น ห้ามใส่ marker ของ markdown (# , - )
    //     ฉบับของเบราว์เซอร์มาจาก blocksToPlainText() ซึ่งไม่มี marker ถ้าที่นี่
    //     ใส่ body_text จะสลับรูปแบบไปมาทุกครั้งที่มีคนเปิดหน้า แล้วผลค้นหา
    //     จะไม่คงที่
    // ─────────────────────────────────────────────────────────────────────
    const projection = await this.docs.getProjection(pageId);
    const body = mode === 'replace' ? '' : (projection?.bodyText ?? '');
    const addition = blocksToPlainText(blocks);

    await this.docs.upsertProjection({
      workspaceId: requireWorkspaceId(),
      pageId,
      accessRootId: page.accessRootId,
      title: page.title,
      bodyText: truncate(body.length > 0 ? `${body}\n${addition}` : addition),
    });

    this.logger.log(`เขียน ${blocks.length} บล็อกลงหน้า ${pageId} (seq ${appended.value.seq})`);

    return ok(appended.value.seq);
  }

  async getBacklinks(pageId: string): Promise<Result<BacklinkDto[]>> {
    // ต้องมีสิทธิ์เห็นหน้าเป้าหมายก่อน ไม่งั้นรายการ backlink กลายเป็นช่องสำรวจ
    // ว่าใน workspace มีหน้าอะไรอยู่บ้างโดยไม่ต้องมีสิทธิ์เห็นหน้านั้น
    const role = await this.permissions.effectiveRole(pageId);
    if (!role) return PAGE_NOT_FOUND;

    const sources = await this.docs.backlinks(pageId, BACKLINK_LIMIT);

    // ─────────────────────────────────────────────────────────────────────
    //  ⚠️ สิทธิ์เห็นหน้า A ไม่ได้แปลว่ามีสิทธิ์รู้ว่าหน้า B ลิงก์มาหา A — B อาจ
    //     อยู่ใต้ access root ที่ผู้ใช้เข้าไม่ได้ ชื่อของ B เองก็เป็นข้อมูลที่
    //     รั่วได้ ("แผนปรับเงินเดือน 2026" ลิงก์มาหาหน้านี้)
    //
    //  ยอมจ่ายเป็น N query เพราะ PermissionService memo ต่อ request อยู่แล้ว
    //  และเพดานอยู่ที่ 50
    // ─────────────────────────────────────────────────────────────────────
    const visible: BacklinkDto[] = [];

    for (const source of sources) {
      if ((await this.permissions.effectiveRole(source.id)) === null) continue;
      visible.push(source);
    }

    return ok(visible);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  รูปแบบไบนารีของ bootstrap
//
//      [u32 count][u32 len][bytes] × count
//
//  frame แรกคือ snapshot (ยาว 0 ถ้ายังไม่เคย compact) ที่เหลือคือ update
//  เรียงตาม seq — client เอาไป Y.applyUpdate ทีละอันตามลำดับ
//
//  ใช้ไบนารีดิบไม่ใช่ JSON+base64 เพราะเอกสารขนาดกลางมี update หลายพันก้อน
//  base64 จะทำให้ payload โต 33% บนเส้นทางที่วิ่งทุกครั้งที่เปิดหน้า
// ═══════════════════════════════════════════════════════════════════════════
function buildFrames(snapshot: Uint8Array | null, updates: readonly Uint8Array[]): Buffer {
  const frames = [snapshot ?? new Uint8Array(0), ...updates];
  const total = 4 + frames.reduce((sum, f) => sum + 4 + f.length, 0);
  const buffer = Buffer.allocUnsafe(total);

  // little-endian ให้ตรงกับ DataView ฝั่ง JS ที่อ่านด้วย littleEndian = true
  let offset = buffer.writeUInt32LE(frames.length, 0);

  for (const frame of frames) {
    offset = buffer.writeUInt32LE(frame.length, offset);
    buffer.set(frame, offset);
    offset += frame.length;
  }

  return buffer;
}

/**
 * snapshot สองตัวขนาดใกล้กันพอที่จะถือว่า "ยืนยันกันเอง" หรือไม่
 *
 * ±25% เผื่อไว้เพราะระหว่างสอง snapshot ผู้ใช้ยังพิมพ์ต่อได้อีกนิดหน่อย แต่ถ้า
 * ห่างกันมากกว่านั้นแปลว่าสอง client เห็นเอกสารคนละแบบ ซึ่งเป็นสัญญาณว่ามี
 * ตัวหนึ่งข้อมูลไม่ครบ
 */
function isSimilarSize(a: number, b: number): boolean {
  if (a === 0 || b === 0) return false;
  return Math.min(a, b) / Math.max(a, b) >= 0.75;
}

const truncate = (text: string): string =>
  text.length <= MAX_PROJECTION_LENGTH ? text : text.slice(0, MAX_PROJECTION_LENGTH);

const PAGE_NOT_FOUND = err.notFound('ไม่พบหน้านี้', 'page_not_found');
const NO_EDIT_PERMISSION = err.forbidden('ไม่มีสิทธิ์แก้ไขหน้านี้', 'insufficient_page_role');
