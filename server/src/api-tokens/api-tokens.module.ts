import { Module } from '@nestjs/common';

import { ApiTokenRepository } from './api-token.repository.js';
import { ApiTokensController } from './api-tokens.controller.js';
import { ApiTokenService } from './api-tokens.service.js';

/**
 * ⚠️ ไม่ import AuthModule แม้จะใช้ TokenService/PasswordService จากที่นั่น
 *    — AuthModule เป็น @Global provider ของมันจึงมองเห็นได้อยู่แล้ว
 *
 *    การ import จะสร้างวงกลมกับ AppModule ที่ import ทั้งสองตัว ซึ่งบน ESM
 *    ทำให้บูตไม่ขึ้น ไม่ใช่แค่ช้าลง
 */
@Module({
  controllers: [ApiTokensController],
  providers: [ApiTokenService, ApiTokenRepository],
  exports: [ApiTokenRepository],
})
export class ApiTokensModule {}
