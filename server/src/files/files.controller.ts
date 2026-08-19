import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { FilesService } from './files.service.js';
import { ApiException, unwrap } from '../common/api-response.js';
import { err } from '../common/result.js';
import { Public, RequireWorkspace } from '../common/route-metadata.js';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /**
   * รับรูปเป็น body ตรง ๆ (Content-Type: image/…) ไม่ใช่ multipart — express.raw
   * ใน bootstrap.ts อ่านให้แล้ว แบบแผนเดียวกับ Yjs update
   */
  @Post()
  @RequireWorkspace()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'อัปโหลดรูป — คืน URL สำหรับใส่ใน image block' })
  async upload(@Req() request: Request) {
    const body: unknown = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new ApiException(
        err.validation(
          'ต้องส่งไฟล์รูปเป็น body ตรง ๆ พร้อม Content-Type ของรูป (image/png, image/jpeg, image/gif, image/webp)',
          'expected_image_body',
        ).error,
      );
    }

    const mime = (request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    return unwrap(await this.files.saveImage(body, mime));
  }

  /**
   * ⚠️ @Public โดยเจตนา — <img src> ของเบราว์เซอร์ไม่ส่ง Authorization header
   *    การควบคุมการเข้าถึงคือความเดารหัสไม่ได้ของชื่อไฟล์ (UUID, ดู FilesService)
   */
  @Public()
  @Get(':name')
  @ApiOperation({ summary: 'เสิร์ฟรูปที่อัปโหลดไว้' })
  async serve(@Param('name') name: string, @Res() response: Response): Promise<void> {
    const resolved = await this.files.resolve(name);
    if (!resolved.ok) throw new ApiException(resolved.error);

    // ชื่อไฟล์มี UUID — เนื้อไม่มีวันเปลี่ยน cache ได้ตลอดกาล
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // กัน browser เดา content-type เอง — คู่กับการตรวจ magic bytes ตอนอัปโหลด
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.sendFile(resolved.value);
  }
}
