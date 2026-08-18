import { Global, Module } from '@nestjs/common';

import { DbService } from './db.service.js';

/**
 * @Global เพราะทุก module ต้องใช้ และการ import DbModule ซ้ำในทุกที่
 * ไม่ได้ทำให้ใครเข้าใจอะไรเพิ่ม
 */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
