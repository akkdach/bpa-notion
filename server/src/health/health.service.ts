import { Injectable } from '@nestjs/common';

import { HealthRepository, REQUIRED_EXTENSIONS, type DatabaseProbe } from './health.repository.js';

export interface HealthDto {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: DatabaseProbe & { missingExtensions: string[] };
}

@Injectable()
export class HealthService {
  constructor(private readonly repo: HealthRepository) {}

  async check(): Promise<{ healthy: boolean; body: HealthDto }> {
    const database = await this.repo.probe();
    const missingExtensions = REQUIRED_EXTENSIONS.filter((e) => !database.extensions.includes(e));

    // ⚠️ "ต่อฐานได้" ไม่พอ — degraded คือกรณีที่ต่อได้แต่ extension หาย ซึ่งทำให้
    //    ค้นหาพังเงียบ ๆ ทั้งที่ทุกอย่างอื่นดูปกติ ต้องแยกจาก unhealthy ให้ชัด
    const status: HealthDto['status'] = !database.canConnect
      ? 'unhealthy'
      : missingExtensions.length > 0
        ? 'degraded'
        : 'healthy';

    return {
      healthy: status === 'healthy',
      body: { status, database: { ...database, missingExtensions } },
    };
  }
}
