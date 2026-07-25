#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  source ไฟล์นี้เพื่อ export ค่าจาก .env ให้ dotnet อ่านได้
#
#      source scripts/dev-env.sh
#      cd api && dotnet run
#
#  ทำไมต้องมี: appsettings.Development.json มี password เป็น placeholder
#  (ห้าม commit ค่าจริง) ค่าจริงอยู่ใน .env ที่ docker compose อ่าน
#  ถ้ารัน dotnet ตรง ๆ จะได้ 28P01 password authentication failed
#
#  อ่านแบบไม่ eval เพื่อไม่ให้ค่าใน .env กลายเป็นคำสั่ง shell
# ═══════════════════════════════════════════════════════════════════════════

__dev_env_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$__dev_env_root/.env" ]]; then
    echo "ไม่พบ .env — รัน: cp .env.example .env" >&2
    return 1 2>/dev/null || exit 1
fi

__read_env() {
    local key="$1" default="${2-}" line
    line=$(grep -E "^${key}=" "$__dev_env_root/.env" | tail -1 || true)
    if [[ -z "$line" ]]; then printf '%s' "$default"; else printf '%s' "${line#*=}"; fi
}

export ASPNETCORE_ENVIRONMENT=Development
export ASPNETCORE_HTTP_PORTS="${API_PORT:-5081}"

export ConnectionStrings__DefaultConnection="Host=localhost;Port=$(__read_env POSTGRES_HOST_PORT 5440);Database=$(__read_env POSTGRES_DB projectmanagement);Username=$(__read_env POSTGRES_USER postgres);Password=$(__read_env POSTGRES_PASSWORD);Include Error Detail=true"

export Jwt__Key="$(__read_env JWT_SECRET)"
export Jwt__Issuer="$(__read_env JWT_ISSUER ProjectManagementAPI)"
export Jwt__ExpiresIn="$(__read_env JWT_EXPIRES_IN 24h)"
export Jwt__RefreshExpiresIn="$(__read_env JWT_REFRESH_EXPIRES_IN 30d)"

# dev รวม vite dev server ด้วย
export Cors__AllowedOrigins__0="$(__read_env WEB_ORIGIN http://localhost)"
export Cors__AllowedOrigins__1="http://localhost:5173"

unset -f __read_env
unset __dev_env_root

echo "dev env พร้อม — API จะฟังที่ http://localhost:${ASPNETCORE_HTTP_PORTS}"
