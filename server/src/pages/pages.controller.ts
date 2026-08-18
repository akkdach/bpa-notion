import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PageTreeService } from './page-tree.service.js';
import {
  type CreatePageInput,
  createPageSchema,
  type MovePageInput,
  movePageSchema,
  type UpdatePageInput,
  updatePageSchema,
} from './pages.schema.js';
import { unwrap } from '../common/api-response.js';
import { RequireWorkspace } from '../common/route-metadata.js';
import { zodBody } from '../common/zod-body.pipe.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Pages — ทุก endpoint ผูกกับ workspace
//
//  ⚠️ ลำดับของ route สำคัญ: 'trash' และ 'maintenance/*' ต้องประกาศ "ก่อน"
//     ':pageId' ไม่งั้น Express จะจับ /pages/trash เข้า handler ของ :pageId
//     แล้ว ParseUUIDPipe จะตอบ 400 แทนที่จะได้ถังขยะ
// ═══════════════════════════════════════════════════════════════════════════
@ApiTags('pages')
@Controller('pages')
@RequireWorkspace()
export class PagesController {
  constructor(private readonly tree: PageTreeService) {}

  @Get()
  @ApiOperation({ summary: 'ทั้ง tree สำหรับ sidebar (กรองตามสิทธิ์แล้ว)' })
  async getTree() {
    return unwrap(await this.tree.getTree());
  }

  @Get('trash')
  async getTrash() {
    return unwrap(await this.tree.getTrash());
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Maintenance
  //
  //  ancestor_ids และ access_root_id เป็นค่า denormalise ที่เพี้ยนได้
  //  สองตัวนี้มีไว้ตรวจและซ่อม ควรตั้ง cron เรียก /consistency ทุกวันในช่วง
  //  เดือนแรก ๆ แล้ว alert เมื่อไม่เป็นศูนย์
  // ─────────────────────────────────────────────────────────────────────

  @Get('maintenance/consistency')
  async checkConsistency() {
    return unwrap(await this.tree.checkConsistency());
  }

  @Post('maintenance/repair')
  @HttpCode(HttpStatus.OK)
  async repair() {
    return unwrap(await this.tree.repair());
  }

  @Get(':pageId')
  async get(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return unwrap(await this.tree.get(pageId));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(zodBody(createPageSchema)) body: CreatePageInput) {
    return unwrap(await this.tree.create(body));
  }

  @Patch(':pageId')
  async update(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodBody(updatePageSchema)) body: UpdatePageInput,
  ) {
    return unwrap(await this.tree.update(pageId, body));
  }

  @Post(':pageId/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ย้ายหน้าพร้อมลูกหลานทั้งหมด' })
  async move(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodBody(movePageSchema)) body: MovePageInput,
  ) {
    return unwrap(await this.tree.move(pageId, body));
  }

  @Delete(':pageId')
  @ApiOperation({ summary: 'ย้ายไปถังขยะ (soft delete) พร้อมลูกหลาน' })
  async delete(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return unwrap(await this.tree.delete(pageId));
  }

  @Post(':pageId/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return unwrap(await this.tree.restore(pageId));
  }

  @Delete(':pageId/purge')
  @ApiOperation({ summary: 'ลบถาวร — owner/admin เท่านั้น ย้อนกลับไม่ได้' })
  async purge(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return unwrap(await this.tree.purge(pageId));
  }
}
