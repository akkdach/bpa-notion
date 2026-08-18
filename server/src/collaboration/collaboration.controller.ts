import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AddNoteInput, addNoteSchema } from './collaboration.schema.js';
import { CollaborationService } from './collaboration.service.js';
import { ApiException, unwrap } from '../common/api-response.js';
import { err } from '../common/result.js';
import { RequireWorkspace } from '../common/route-metadata.js';
import { zodBody } from '../common/zod-body.pipe.js';
import { USER_KINDS, type UserKind } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  บันทึกบนหน้า
//
//  ⚠️ append-only โดยเจตนา ไม่มี PATCH และไม่มี DELETE
//     บันทึกที่แก้ย้อนหลังได้ไม่ใช่บันทึก — ถ้า AI เขียนผิดให้เขียนใหม่ต่อท้าย
//     ประวัติที่เห็นการแก้ตัวเป็นข้อมูลที่มีค่ากว่าประวัติที่ดูสะอาด
// ═══════════════════════════════════════════════════════════════════════════
@ApiTags('collaboration')
@Controller('pages/:pageId/notes')
@RequireWorkspace()
export class PageNotesController {
  constructor(private readonly collaboration: CollaborationService) {}

  @Get()
  async list(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return unwrap(await this.collaboration.listNotes(pageId));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ช่องให้ AI รายงานความคืบหน้าโดยไม่ต้องแตะเนื้อหาหน้า' })
  async add(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodBody(addNoteSchema)) body: AddNoteInput,
  ) {
    return unwrap(await this.collaboration.addNote(pageId, body));
  }
}

@ApiTags('collaboration')
@Controller('activity')
@RequireWorkspace()
export class ActivityController {
  constructor(private readonly collaboration: CollaborationService) {}

  @Get()
  @ApiOperation({ summary: 'ฟีดกิจกรรม — ใครทำอะไรกับหน้าไหนเมื่อไหร่' })
  async list(
    @Query('pageId') pageId: string | undefined,
    @Query('actorKind') actorKind: string | undefined,
    @Query('since') since: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    if (actorKind !== undefined && !(USER_KINDS as readonly string[]).includes(actorKind)) {
      throw new ApiException(
        err.validation(`ประเภทผู้ทำต้องเป็น ${USER_KINDS.join(' หรือ ')}`, 'invalid_user_kind').error,
      );
    }

    if (since !== undefined && Number.isNaN(Date.parse(since))) {
      throw new ApiException(err.validation('since ต้องเป็นเวลารูปแบบ ISO 8601', 'invalid_since').error);
    }

    const parsedLimit = limit === undefined ? undefined : Number(limit);

    return unwrap(
      await this.collaboration.getActivity({
        ...(pageId !== undefined ? { pageId } : {}),
        ...(actorKind !== undefined ? { actorKind: actorKind as UserKind } : {}),
        ...(since !== undefined ? { since } : {}),
        ...(parsedLimit !== undefined && Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {}),
      }),
    );
  }
}
