import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type CreateApiTokenInput, createApiTokenSchema } from './api-tokens.schema.js';
import { ApiTokenService } from './api-tokens.service.js';
import { unwrap } from '../common/api-response.js';
import { RequireWorkspace } from '../common/route-metadata.js';
import { zodBody } from '../common/zod-body.pipe.js';

// ═══════════════════════════════════════════════════════════════════════════
//  API token — กุญแจให้เครื่องภายนอก (MCP server) เข้าถึง workspace นี้
//
//  แทนที่การให้เครื่องภายนอกเก็บอีเมล/รหัสผ่านไว้แล้ว login เอง:
//  token ผูกกับ workspace เดียว เพิกถอนรายใบได้ และรู้ว่าใช้ครั้งสุดท้ายเมื่อไหร่
//
//  ⚠️ ค่าจริงของ token แสดง "ครั้งเดียว" ตอนสร้าง ฐานข้อมูลเก็บแค่ SHA-256
//     ทำหายแล้วต้องออกใบใหม่ ไม่มี endpoint ขอดูอีกครั้งโดยเจตนา
// ═══════════════════════════════════════════════════════════════════════════
@ApiTags('api-tokens')
@Controller('workspaces/current/tokens')
@RequireWorkspace()
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokenService) {}

  @Get()
  async list() {
    return unwrap(await this.tokens.list());
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ออก token ใหม่ — ค่าจริงอยู่ใน response นี้ครั้งเดียวเท่านั้น' })
  async create(@Body(zodBody(createApiTokenSchema)) body: CreateApiTokenInput) {
    return unwrap(await this.tokens.create(body));
  }

  @Delete(':tokenId')
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('tokenId', ParseUUIDPipe) tokenId: string) {
    return unwrap(await this.tokens.revoke(tokenId));
  }
}
