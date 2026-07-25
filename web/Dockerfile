# ═══════════════════════════════════════════════════════════════════════════
#  ProjectManagement web — Vite build → nginx
# ═══════════════════════════════════════════════════════════════════════════

# ─── Stage 1: build ────────────────────────────────────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

# copy manifest ก่อนแล้ว ci — layer นี้ cache ได้ตราบใดที่ dependency ไม่เปลี่ยน
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# ─────────────────────────────────────────────────────────────────────────
#  VITE_* เป็น build-time ไม่ใช่ runtime — Vite ฝังค่าลง bundle ตอน build
#  จึงต้องรับผ่าน ARG (ส่งมาจาก docker-compose) ไม่ใช่ ENV ตอน runtime
#
#  ⚠️ ค่าที่ใส่ที่นี่จะอยู่ใน JS ที่ทุกคนดาวน์โหลดได้ — ห้ามใส่ความลับ
#
#  ค่า default เป็น path แบบ same-origin เพราะ nginx proxy ให้อยู่แล้ว
# ─────────────────────────────────────────────────────────────────────────
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_HUB_URL=/hubs/doc
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_HUB_URL=$VITE_HUB_URL

RUN npm run build

# ─── Stage 2: serve ───────────────────────────────────────────────────────
FROM nginx:stable-alpine AS production

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
