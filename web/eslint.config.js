import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import boundaries from 'eslint-plugin-boundaries'

// ═══════════════════════════════════════════════════════════════════════════
//  ESLint — รวม architecture gate ไว้ด้วย
//
//  กฎ layer ใน PLAN.md จะเป็นแค่ของประดับถ้าไม่มี linter บังคับ ไฟล์นี้คือตัวบังคับ
//  ทิศทาง dependency มีทางเดียว:
//
//      app → page → features → components/common → components/ui → lib
//
//  ห้ามย้อนทิศ และห้ามข้าม feature ตรง ๆ (ต้องผ่าน index.ts ของ feature นั้น)
//
//  ⚠️ ใช้ syntax ของ eslint-plugin-boundaries v7:
//     · rule ชื่อ `boundaries/dependencies` (v6 เปลี่ยนจาก `element-types`)
//     · ใช้ `policies` ไม่ใช่ `rules`
//     · template เป็น {{...}} ไม่ใช่ ${...}
//     · selector เป็น object: { type, captured: { … } }
//     · element เป็น "folder mode" เสมอ → pattern ต้องชี้ที่โฟลเดอร์
//       (นี่คือเหตุผลที่ App.tsx / routes.tsx อยู่ใน src/app/ ไม่ใช่ src/)
// ═══════════════════════════════════════════════════════════════════════════

/** element เดียวกับ feature ของไฟล์ต้นทาง — ใช้กันการ import ข้าม feature */
const sameFeature = (type) => ({
  type,
  captured: { featureName: '{{from.captured.featureName}}' },
})

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },

  // ─── base ────────────────────────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // default export ทำให้ rename-refactor พลาดและทำให้ barrel กำกวม
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message:
            'ใช้ named export — ดู PLAN.md "Engineering standards — Frontend" ข้อ 5',
        },
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // floating promise คือ error ที่หายไปเงียบ ๆ — สำคัญมากกับ Yjs/SignalR
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  // ─── architecture gate #1: layer boundaries ──────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // ⚠️ ลำดับสำคัญ — pattern ที่เจาะจงกว่าต้องมาก่อน (match ตัวแรกชนะ)
      'boundaries/elements': [
        { type: 'feature-service', pattern: 'src/features/*/service', capture: ['featureName'] },
        { type: 'feature-hooks', pattern: 'src/features/*/hooks', capture: ['featureName'] },
        { type: 'feature-components', pattern: 'src/features/*/components', capture: ['featureName'] },
        { type: 'feature-root', pattern: 'src/features/*', capture: ['featureName'] },
        { type: 'ui', pattern: 'src/components/ui' },
        { type: 'common', pattern: 'src/components/common' },
        { type: 'layout', pattern: 'src/components/layout' },
        { type: 'page', pattern: 'src/page' },
        { type: 'realtime', pattern: 'src/realtime' },
        { type: 'store', pattern: 'src/store' },
        { type: 'lib', pattern: 'src/lib' },
        { type: 'app', pattern: 'src/app' },
      ],
      // entry point (main.tsx) กับ type declaration ไม่ใช่ layer
      'boundaries/ignore': ['src/main.tsx', 'src/vite-env.d.ts', 'src/**/*.css'],

      // ⚠️ จำเป็น: boundaries ต้อง resolve '@/…' ให้เป็น path จริงก่อน ไม่งั้น
      //    dependency จะเป็น isUnknown แล้ว policy ทั้งหมด "ผ่านหมด" เงียบ ๆ
      //    — gate จะดูเหมือนทำงานแต่ไม่จับอะไรเลย
      'import/resolver': {
        typescript: { project: './tsconfig.app.json' },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // handlebars context มี from / to / dependency
          // (`target` เป็นชื่อของ legacy ${...} syntax ใช้กับ {{...}} ไม่ได้)
          message:
            'layer "{{from.type}}" ห้าม import layer "{{to.type}}" ' +
            '({{dependency.source}}) — ผิดทิศทาง dependency, ดู PLAN.md',
          policies: [
            // ── leaf layers ────────────────────────────────────────────────
            { from: [{ type: 'lib' }], allow: [{ type: 'lib' }] },
            { from: [{ type: 'store' }], allow: [{ type: 'lib' }] },
            { from: [{ type: 'realtime' }], allow: [{ type: 'realtime' }, { type: 'lib' }] },

            // ── components: ยิ่งล่างยิ่งรู้เรื่องแอปน้อย ───────────────────
            // ui ต้อง copy ไปโปรเจกต์อื่นได้ทั้งก้อน จึงเห็นได้แค่ lib
            { from: [{ type: 'ui' }], allow: [{ type: 'ui' }, { type: 'lib' }] },
            {
              from: [{ type: 'common' }],
              allow: [{ type: 'common' }, { type: 'ui' }, { type: 'lib' }],
            },
            {
              from: [{ type: 'layout' }],
              allow: [
                { type: 'layout' },
                { type: 'common' },
                { type: 'ui' },
                { type: 'lib' },
              ],
            },

            // ── feature internals ─────────────────────────────────────────
            // service = ชั้น HTTP เท่านั้น
            {
              from: [{ type: 'feature-service' }],
              allow: [
                { type: 'lib' },
                sameFeature('feature-service'),
                sameFeature('feature-root'),
              ],
            },
            // hooks = ที่เดียวที่ fetch ข้อมูล
            {
              from: [{ type: 'feature-hooks' }],
              allow: [
                { type: 'lib' },
                { type: 'store' },
                { type: 'realtime' },
                { type: 'feature-root' },
                sameFeature('feature-service'),
                sameFeature('feature-hooks'),
              ],
            },
            // components = presentational — ห้ามแตะ service โดยตรง
            {
              from: [{ type: 'feature-components' }],
              allow: [
                { type: 'lib' },
                { type: 'ui' },
                { type: 'common' },
                { type: 'store' },
                { type: 'feature-root' },
                sameFeature('feature-hooks'),
                sameFeature('feature-components'),
              ],
            },
            // root = index.ts / Provider — เห็นทุกอย่างใน feature ตัวเอง
            {
              from: [{ type: 'feature-root' }],
              allow: [
                { type: 'lib' },
                { type: 'ui' },
                { type: 'common' },
                { type: 'store' },
                { type: 'realtime' },
                { type: 'feature-root' },
                sameFeature('feature-service'),
                sameFeature('feature-hooks'),
                sameFeature('feature-components'),
              ],
            },

            // ── top ───────────────────────────────────────────────────────
            {
              from: [{ type: 'page' }],
              allow: [
                { type: 'lib' },
                { type: 'ui' },
                { type: 'common' },
                { type: 'layout' },
                { type: 'store' },
                { type: 'feature-root' },
              ],
            },
            {
              from: [{ type: 'app' }],
              allow: [
                { type: 'lib' },
                { type: 'ui' },
                { type: 'common' },
                { type: 'layout' },
                { type: 'store' },
                { type: 'page' },
                { type: 'realtime' },
                { type: 'app' },
                { type: 'feature-root' },
              ],
            },
          ],
        },
      ],

      // ไฟล์ใน src/ ที่ไม่ตรง element ไหนเลย = วางผิดที่
      'boundaries/no-unknown-files': 'error',
    },
  },

  // ─── architecture gate #2: axios อยู่ได้แค่ใน service/ ───────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/features/*/service/**', 'src/lib/apiClient.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'axios',
              message:
                'axios ใช้ได้เฉพาะใน features/*/service/ และ lib/apiClient.ts — ' +
                'component ที่ import axios คือบั๊ก (PLAN.md frontend ข้อ 2)',
            },
          ],
          patterns: [
            {
              group: ['@/lib/apiClient', '**/lib/apiClient'],
              message: 'ห้ามเรียก apiClient ตรง ๆ — เข้าผ่าน features/*/service/ เท่านั้น',
            },
          ],
        },
      ],
    },
  },

  // ─── config / e2e ────────────────────────────────────────────────────────
  {
    files: ['*.config.{ts,js}', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // tool พวกนี้บังคับ default export
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
)
