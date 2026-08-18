import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { HealthService } from './health.service.js';
import { envelopeOk } from '../common/api-response.js';
import { Public } from '../common/route-metadata.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'สถานะของระบบ — 503 เมื่อฐานข้อมูลใช้งานไม่ได้หรือ extension หาย' })
  async check(@Res() response: Response): Promise<void> {
    const { healthy, body } = await this.health.check();

    // ⚠️ status code ต้องบอกความจริงด้วย ไม่ใช่แค่ field ใน body — ตัวตรวจสุขภาพ
    //    ของ docker/IIS อ่าน status code อย่างเดียว ถ้าตอบ 200 เสมอมันจะไม่มีวัน
    //    รู้ว่าระบบพัง
    response.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(envelopeOk(body));
  }
}
