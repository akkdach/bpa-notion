import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// ═══════════════════════════════════════════════════════════════════════════
//  eslint — คู่กับ scripts/check-architecture.mjs ไม่ใช่แทนกัน
//
//  แบ่งงานกันแบบนี้:
//    · eslint          — กฎที่ต้องรู้จัก "ชนิด" ถึงจะตรวจได้ และกฎที่อยากได้
//                        feedback ทันทีในตัวแก้ไข
//    · check-architecture — กฎเรื่อง "ใครแตะอะไรได้" ซึ่งอ่านง่ายกว่าเมื่อเขียน
//                        เป็นรายการเดียวพร้อมเหตุผล และรายงานเป็นภาษาคนได้
// ═══════════════════════════════════════════════════════════════════════════
export default tseslint.config(
  // ⚠️ scripts/*.mjs เป็น JS ล้วนโดยเจตนา — มันต้องรันได้ด้วย `node` เปล่า ๆ
  //    ทั้งบนเครื่อง dev และใน CI โดยไม่ต้อง build อะไรก่อน
  { ignores: ['dist/**', 'drizzle/**', 'node_modules/**', '**/*.mjs'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // ─────────────────────────────────────────────────────────────────
      //  ⚠️ กฎที่สำคัญที่สุดในไฟล์นี้
      //
      //  โค้ดทั้งก้อนเป็น async และทุก query อยู่ในธุรกรรมที่มีอายุจำกัด
      //  promise ที่ลืม await จะทำงานต่อ "หลัง" ธุรกรรม commit ไปแล้ว —
      //  ผลคือเขียนไม่ลง หรือลงคนละธุรกรรมกับที่ตั้งใจ โดยไม่มี error ให้เห็น
      // ─────────────────────────────────────────────────────────────────
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/await-thenable': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // ⚠️ ปิดไว้: Nest ใช้ decorator กับ class ที่ eslint มองว่า unsafe หลายที่
      //    และ drizzle คืน type ที่กว้างจากบาง overload — กฎพวกนี้ทำให้ต้องเขียน
      //    cast ที่ไม่ได้เพิ่มความปลอดภัย tsc strict ครอบให้อยู่แล้ว
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  {
    // เทสยิง endpoint จริงแล้ว assert — ไม่ต้องแคร์ค่า return ที่ไม่ได้ใช้
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
)
