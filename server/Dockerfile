# ═══════════════════════════════════════════════════════════════════════════
#  server — NestJS + Drizzle
#
#  ⚠️ multi-stage: ขั้น build ต้องมี devDependencies (nest cli, typescript)
#     ขั้นที่รันจริงต้องไม่มี — ทั้งเรื่องขนาดและเรื่องพื้นที่โจมตี
# ═══════════════════════════════════════════════════════════════════════════
FROM node:22-bookworm-slim AS build

WORKDIR /app

# ─────────────────────────────────────────────────────────────────────────
#  ⚠️ argon2 เป็น native addon — ต้องมี toolchain ตอน npm ci
#     ถ้าไม่มี npm จะ fallback ไปคอมไพล์ไม่ผ่านแล้วพังตอน require() ไม่ใช่ตอน build
# ─────────────────────────────────────────────────────────────────────────
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ─── ตัด devDependencies ออกหลัง build ────────────────────────────────────
RUN npm prune --omit=dev


FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# ⚠️ รันด้วยผู้ใช้ที่ไม่ใช่ root — image ของ node มี user `node` มาให้แล้ว
#    (สอดคล้องกับหลักเดียวกับที่ runtime ต่อฐานด้วย pm_app ไม่ใช่ postgres)
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# migration + SQL objects ต้องอยู่ใน image ด้วย — db:setup รันจากที่นี่
COPY --from=build --chown=node:node /app/node_modules/.bin ./node_modules/.bin
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node sql ./sql
COPY --chown=node:node scripts ./scripts

USER node
EXPOSE 8080
ENV PORT=8080

# ⚠️ ไม่มี HEALTHCHECK ที่นี่โดยเจตนา — docker-compose กำหนดเอง เพื่อให้ปรับ
#    ช่วงเวลาได้โดยไม่ต้อง build image ใหม่
CMD ["node", "dist/main.js"]
