import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { DocumentService } from './documents.service.js';
import {
  type AppendMarkdownInput,
  appendMarkdownSchema,
  type AppendParagraphsInput,
  appendParagraphsSchema,
  type ProjectionInput,
  projectionSchema,
} from './documents.schema.js';
import { ApiException, unwrap } from '../common/api-response.js';
import { err } from '../common/result.js';
import { RequireWorkspace } from '../common/route-metadata.js';
import { zodBody } from '../common/zod-body.pipe.js';

/** ขนาดสูงสุดของ body ไบนารีที่รับ */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

// ═══════════════════════════════════════════════════════════════════════════
//  เนื้อหาของหน้า (Yjs)
//
//  ⚠️ bootstrap อยู่บน REST ไม่ใช่ WebSocket โดยเจตนา — full state ของเอกสาร
//     ที่ใช้งานจริงใหญ่ได้ง่าย ๆ และการใช้ REST ได้ HTTP compression มาฟรี ๆ
//
//  ⚠️ สัญญาของสามเส้นแรกเป็น "ไบนารีล้วน" ซึ่ง web/ ใช้อยู่แล้ว
//     (ดู web/src/features/editor/service/docApi.ts) — metadata ไปกับ header
//     เพื่อให้ body ไม่มีอะไรปนนอกจากไบต์ของ Yjs
// ═══════════════════════════════════════════════════════════════════════════
@ApiTags('documents')
@Controller('pages/:pageId')
@RequireWorkspace()
export class DocumentsController {
  constructor(private readonly documents: DocumentService) {}

  @Get('ydoc')
  @ApiOperation({ summary: 'snapshot + update ที่เกิดหลังจากนั้น เป็น [u32 count][u32 len][bytes]…' })
  async getDocument(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Res() response: Response,
  ): Promise<void> {
    const doc = unwrap(await this.documents.bootstrap(pageId));

    response.setHeader('X-Doc-Role', doc.role);
    response.setHeader('X-Doc-Head-Seq', String(doc.headSeq));
    response.setHeader('X-Doc-Snapshot-Up-To', String(doc.snapshotUpToSeq));
    response.setHeader('X-Doc-Updates-Since-Snapshot', String(doc.updatesSinceSnapshot));
    response.setHeader('X-Doc-Should-Compact', doc.shouldCompact ? '1' : '0');

    // ห้าม cache — เนื้อหาเปลี่ยนตลอด และ header พวกนี้เป็น state ปัจจุบัน
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/octet-stream');

    response.send(doc.frames);
  }

  @Post('ydoc/update')
  @HttpCode(HttpStatus.OK)
  async appendUpdate(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Query('yClientId') yClientId: string | undefined,
    @Req() request: Request,
  ) {
    const body = readBinaryBody(request);
    const clientId = yClientId === undefined ? null : Number(yClientId);

    return unwrap(
      await this.documents.appendUpdate(
        pageId,
        body,
        clientId !== null && Number.isFinite(clientId) ? clientId : null,
      ),
    );
  }

  @Post('ydoc/snapshot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'snapshot ที่ client สร้าง (Y.encodeStateAsUpdate) — ใช้ compact log' })
  async saveSnapshot(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Query('upToSeq') upToSeq: string | undefined,
    @Req() request: Request,
  ) {
    const seq = Number(upToSeq);
    if (!Number.isInteger(seq) || seq < 0) {
      throw new ApiException(err.validation('upToSeq ต้องเป็นจำนวนเต็มไม่ติดลบ', 'invalid_up_to_seq').error);
    }

    return unwrap(await this.documents.saveSnapshot(pageId, readBinaryBody(request), seq));
  }

  @Get('content')
  @ApiOperation({
    summary: 'เนื้อหาเป็น plain text — ทางที่ไม่ใช่เบราว์เซอร์ (เช่น AI ผ่าน MCP) อ่านเนื้อหาได้',
  })
  async getContent(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return unwrap(await this.documents.getContent(pageId));
  }

  /**
   * ⚠️ ต่อท้ายเท่านั้น แก้หรือลบของเดิมไม่ได้
   * ⚠️ เป็น POST ไม่ใช่ PUT โดยเจตนา — PUT สื่อว่าเขียนทับทั้งทรัพยากร ซึ่งเป็น
   *    สิ่งที่ endpoint นี้ตั้งใจ "ไม่" ทำ
   */
  @Post('content/paragraphs')
  @HttpCode(HttpStatus.OK)
  async appendParagraphs(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodBody(appendParagraphsSchema)) body: AppendParagraphsInput,
  ) {
    return unwrap(await this.documents.appendParagraphs(pageId, body.paragraphs));
  }

  @Post('content/markdown')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ต่อท้ายเนื้อหาที่เขียนเป็น markdown — ```mermaid เป็นแผนภาพจริง' })
  async appendMarkdown(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodBody(appendMarkdownSchema)) body: AppendMarkdownInput,
  ) {
    return unwrap(await this.documents.appendMarkdown(pageId, body.markdown));
  }

  /**
   * ⚠️ เส้นเดียวที่ "ลบ" เนื้อหาเดิมได้ — เขียนทับทั้งหน้าด้วย markdown ชุดใหม่
   *    ยังเป็น delta ปกติของ CRDT (ประวัติใน update log อยู่ครบ) แต่สำหรับ
   *    ผู้ใช้แล้วของเดิมหายไปจริง ผู้เรียกควรอ่าน /content ก่อนเสมอ
   */
  @Post('content/replace')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'เขียนทับเนื้อหาทั้งหน้าด้วย markdown — ของเดิมถูกแทนที่ทั้งหมด' })
  async replaceMarkdown(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodBody(appendMarkdownSchema)) body: AppendMarkdownInput,
  ) {
    return unwrap(await this.documents.replaceMarkdown(pageId, body.markdown));
  }

  @Post('projection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'plain text ที่ client แกะจาก Y.Doc — ใช้ทำ index ค้นหาและ title' })
  async saveProjection(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodBody(projectionSchema)) body: ProjectionInput,
  ) {
    return unwrap(await this.documents.saveProjection(pageId, body));
  }

  @Get('backlinks')
  async getBacklinks(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return unwrap(await this.documents.getBacklinks(pageId));
  }
}

/**
 * อ่าน body แบบไบนารี
 *
 * express.raw() ใน main.ts เป็นคนอ่านให้ — ที่นี่แค่ตรวจว่าได้ของจริงมา
 * (raw() คืน object ว่างเมื่อ content-type ไม่ตรง ซึ่งเป็นความผิดพลาดที่พบบ่อย
 *  ของผู้เรียกที่ลืมตั้ง header)
 */
function readBinaryBody(request: Request): Uint8Array {
  const body: unknown = request.body;

  if (!Buffer.isBuffer(body)) {
    throw new ApiException(
      err.validation('ต้องส่ง body เป็น application/octet-stream', 'expected_binary_body').error,
    );
  }

  if (body.length === 0) {
    throw new ApiException(err.validation('ไม่มีข้อมูลใน body', 'empty_body').error);
  }

  if (body.length > MAX_BODY_BYTES) {
    throw new ApiException(
      err.validation(`ข้อมูลใหญ่เกิน ${MAX_BODY_BYTES / 1024 / 1024} MB`, 'payload_too_large').error,
    );
  }

  return new Uint8Array(body);
}
