#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  dotnet ef wrapper
#
#  ปัญหาที่แก้: appsettings.Development.json มี password เป็น placeholder
#  (ห้าม commit ค่าจริง) ส่วนค่าจริงอยู่ใน .env ที่ฝั่ง docker compose อ่าน
#  ถ้ารัน `dotnet ef` ตรง ๆ จะได้ 28P01 password authentication failed
#
#  script นี้อ่าน .env แล้วประกอบ connection string ที่ชี้ไปที่ postgres ใน
#  compose (ผ่าน POSTGRES_HOST_PORT บน host) แล้วส่งเข้าเป็น env var ซึ่ง
#  override ค่าใน appsettings ตามลำดับความสำคัญของ .NET configuration
#
#  ใช้:
#    bash scripts/ef.sh migrations add AddSomething --output-dir Data/Migrations
#    bash scripts/ef.sh database update
#    bash scripts/ef.sh migrations list
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
    echo "ไม่พบ .env — รัน: cp .env.example .env แล้วตั้งค่าก่อน" >&2
    exit 1
fi

# อ่าน .env แบบไม่ eval (กัน command injection จากค่าใน .env)
read_env() {
    local key="$1" default="${2-}"
    local line
    line=$(grep -E "^${key}=" .env | tail -1 || true)
    if [[ -z "$line" ]]; then
        printf '%s' "$default"
    else
        printf '%s' "${line#*=}"
    fi
}

DB=$(read_env POSTGRES_DB projectmanagement)
USER=$(read_env POSTGRES_USER postgres)
PASSWORD=$(read_env POSTGRES_PASSWORD)
PORT=$(read_env POSTGRES_HOST_PORT 5440)

if [[ -z "$PASSWORD" ]]; then
    echo "POSTGRES_PASSWORD ว่างใน .env" >&2
    exit 1
fi

export ASPNETCORE_ENVIRONMENT=Development
export ConnectionStrings__DefaultConnection="Host=localhost;Port=${PORT};Database=${DB};Username=${USER};Password=${PASSWORD};Include Error Detail=true"

# Jwt:Key ต้องมีค่าเพราะ Program.cs ตรวจตอน startup และ dotnet ef สร้าง host จริง
export Jwt__Key="$(read_env JWT_SECRET)"
export Cors__AllowedOrigins__0="$(read_env WEB_ORIGIN http://localhost)"

echo "→ dotnet ef $* (localhost:${PORT}/${DB})"
cd api
exec dotnet ef "$@"
