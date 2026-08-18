import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // ─────────────────────────────────────────────────────────────────────
    //  ⚠️ swc ไม่ใช่ esbuild ที่ vitest ใช้เอง — และนี่ไม่ใช่เรื่องความเร็ว
    //
    //  Nest DI อ่านชนิดของ constructor parameter จาก metadata ที่ compiler
    //  ฝังให้ (emitDecoratorMetadata) esbuild รองรับ experimentalDecorators
    //  แต่ **ไม่รองรับ emitDecoratorMetadata** เลย
    //
    //  ผลคือทุก provider resolve ไม่ได้ แล้ว NestFactory.create() ตายพร้อมกับ
    //  worker ของ vitest ทั้งตัว — ข้อความที่ได้คือ "Worker exited unexpectedly"
    //  ซึ่งไม่บอกอะไรเลยว่าสาเหตุจริงคืออะไร
    // ─────────────────────────────────────────────────────────────────────
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],

    // ⚠️ ไฟล์เดียวต่อครั้ง ไม่ใช่ขนานกัน
    //
    //    เทสแชร์ฐานเดียวกันและบางข้อบังคับ pool ให้เหลือ connection เดียวเพื่อ
    //    พิสูจน์ว่าค่าไม่ติดค้าง การรันขนานทำให้ผลของไฟล์หนึ่งไปโผล่ในอีกไฟล์
    //    แล้วเทสจะ flaky ในทางที่ทำให้คนเลิกเชื่อผลของมัน
    fileParallelism: false,

    // ต่อฐานจริง ไม่ใช่ mock — RLS เป็นพฤติกรรมของ Postgres ล้วน ๆ
    // และ argon2 ที่ 19 MiB กินเวลาจริงหลายสิบมิลลิวินาทีต่อครั้ง
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
