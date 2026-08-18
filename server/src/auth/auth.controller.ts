import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  type LoginInput,
  loginSchema,
  type RefreshInput,
  refreshSchema,
  type RegisterInput,
  registerSchema,
} from './auth.schema.js';
import { AuthService, type ClientInfo } from './auth.service.js';
import { unwrap } from '../common/api-response.js';
import { requireUserId } from '../common/request-context.js';
import { Public } from '../common/route-metadata.js';
import { zodBody } from '../common/zod-body.pipe.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Auth
//
//  controller บาง: bind → เรียก service → แกะ Result
//  ไม่มี DbService ไม่มี business logic ไม่มี try/catch (มี ApiExceptionFilter)
// ═══════════════════════════════════════════════════════════════════════════
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body(zodBody(registerSchema)) body: RegisterInput, @Req() req: Request) {
    return unwrap(await this.auth.register(body, readClient(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body(zodBody(loginSchema)) body: LoginInput, @Req() req: Request) {
    return unwrap(await this.auth.login(body, readClient(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body(zodBody(refreshSchema)) body: RefreshInput, @Req() req: Request) {
    return unwrap(await this.auth.refresh(body.refreshToken, readClient(req)));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body(zodBody(refreshSchema)) body: RefreshInput) {
    return unwrap(await this.auth.logout(body.refreshToken));
  }

  @Get('me')
  @ApiOperation({ summary: 'ข้อมูล user ปัจจุบัน + workspace ทั้งหมดที่เป็นสมาชิก' })
  async me() {
    return unwrap(await this.auth.getCurrent(requireUserId()));
  }
}

/**
 * ⚠️ req.ip เชื่อได้ต่อเมื่อ trust proxy ถูกตั้งให้ตรงกับจำนวน proxy จริง
 *    (ดู main.ts) ถ้าตั้งผิด ค่านี้จะเป็นสิ่งที่ client ยัดมาใน X-Forwarded-For
 *    ได้เอง — ค่านี้ใช้แค่แสดงในรายการ session จึงไม่ถึงกับอันตราย แต่ก็ไม่ควร
 *    เอาไปใช้ตัดสินใจอะไร
 */
const readClient = (req: Request): ClientInfo => ({
  userAgent: req.headers['user-agent'] ?? null,
  ipAddress: req.ip ?? null,
});
