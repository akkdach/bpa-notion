import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { ApiTokensModule } from './api-tokens/api-tokens.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RequestContextInterceptor } from './auth/request-context.interceptor.js';
import { CollaborationModule } from './collaboration/collaboration.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from './common/response-envelope.interceptor.js';
import { DbModule } from './db/db.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { FilesModule } from './files/files.module.js';
import { HealthModule } from './health/health.module.js';
import { PagesModule } from './pages/pages.module.js';
import { SearchModule } from './search/search.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️ ลำดับของ interceptor สำคัญ
//
//     Nest รัน interceptor "ขาเข้า" ตามลำดับที่ประกาศ และ "ขาออก" ย้อนกลับ
//     RequestContextInterceptor ต้องมาก่อน เพราะมันเป็นตัวเปิดธุรกรรมที่ครอบ
//     ทุกอย่าง ส่วน ResponseEnvelopeInterceptor แค่ห่อค่าที่ได้ตอนขาออก
//
//     ถ้าสลับกัน envelope จะถูกสร้างนอกธุรกรรม ซึ่งยังทำงานได้ แต่ error ที่เกิด
//     ตอน commit จะไม่ถูกห่อ — response หน้าตาคนละอย่างเฉพาะกรณีที่ debug ยากสุด
// ═══════════════════════════════════════════════════════════════════════════
@Module({
  imports: [
    DbModule,
    AuthModule,
    ApiTokensModule,
    WorkspacesModule,
    PagesModule,
    DocumentsModule,
    FilesModule,
    SearchModule,
    CollaborationModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
