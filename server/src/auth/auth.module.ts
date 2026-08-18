import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { IdentityRepository } from './identity.repository.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { loadEnv } from '../config/env.js';

/**
 * @Global เพราะ RequestContextInterceptor (ที่ผูกไว้ระดับ app) ต้องใช้
 * TokenService และ IdentityRepository — และ module อื่นแทบทุกตัวก็ต้องใช้
 * IdentityRepository อยู่ดี
 *
 * ⚠️ ห้าม import ApiTokensModule ที่นี่ แม้ RequestContextInterceptor จะต้องใช้
 *    ApiTokenRepository — interceptor ถูกประกาศใน AppModule ไม่ใช่ที่นี่
 *
 *    เวอร์ชันแรกเผลอ import แล้วเกิดวงกลมกับ forwardRef ฝั่ง ApiTokensModule
 *    ผลบน ESM ไม่ใช่ warning แต่เป็น "Cannot access 'ApiTokensModule' before
 *    initialization" ตอนบูต — โปรเซสไม่ขึ้นเลย
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      // ⚠️ HS256 ไม่ใช่ RS256 — ระบบนี้เซ็นและตรวจด้วย process เดียวกัน
      //    ไม่มีฝ่ายที่สามที่ต้องตรวจ token โดยไม่มีสิทธิ์ออก token
      secret: loadEnv().JWT_SECRET,
      signOptions: { algorithm: 'HS256' },
      verifyOptions: { algorithms: ['HS256'] },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, IdentityRepository, PasswordService, TokenService],
  exports: [IdentityRepository, PasswordService, TokenService],
})
export class AuthModule {}
