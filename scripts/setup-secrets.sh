#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  ตั้งค่าความลับสำหรับ dev ครั้งเดียวจบ (ฝั่ง bash — คู่แฝดของ setup-secrets.ps1)
#
#      bash scripts/setup-secrets.sh
#
#  อ่านค่าจริงจาก .env แล้วเขียนลง .NET Secret Manager (~/.microsoft/usersecrets/)
#  เมื่อรันแล้ว `dotnet run` / `dotnet ef` ต่อฐานได้ทันทีโดยไม่ต้อง export env var
#
#  รันซ้ำได้เสมอ — ทับค่าเดิม
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
    echo "ไม่พบ .env — รัน: cp .env.example .env แล้วตั้งค่าก่อน" >&2
    exit 1
fi

# อ่านแบบไม่ eval (กัน command injection จากค่าใน .env)
read_env() {
    local key="$1" default="${2-}" line
    line=$(grep -E "^${key}=" .env | tail -1 || true)
    if [[ -z "$line" ]]; then printf '%s' "$default"; else printf '%s' "${line#*=}"; fi
}

PASSWORD=$(read_env POSTGRES_PASSWORD)
JWT_SECRET=$(read_env JWT_SECRET)
HOST_PORT=$(read_env POSTGRES_HOST_PORT 5440)
DB=$(read_env POSTGRES_DB projectmanagement)
USER_NAME=$(read_env POSTGRES_USER postgres)

[[ -n "$PASSWORD" ]]   || { echo "POSTGRES_PASSWORD ว่างใน .env" >&2; exit 1; }
[[ -n "$JWT_SECRET" ]] || { echo "JWT_SECRET ว่างใน .env" >&2; exit 1; }

dotnet user-secrets init --project api >/dev/null
dotnet user-secrets set "Postgres:Password" "$PASSWORD" --project api >/dev/null
dotnet user-secrets set "Jwt:Key" "$JWT_SECRET" --project api >/dev/null

echo
echo "✓ ตั้งค่า user secrets เรียบร้อย"
echo "  Postgres:Password  ← POSTGRES_PASSWORD (${#PASSWORD} ตัวอักษร)"
echo "  Jwt:Key            ← JWT_SECRET (${#JWT_SECRET} ตัวอักษร)"
echo
echo "  connection string ที่จะได้:  Host=localhost;Port=${HOST_PORT};Database=${DB};Username=${USER_NAME}"
echo "  (host/port/database อยู่ใน api/appsettings.Development.json — ไม่ใช่ความลับ)"
echo
echo "  ต่อไปนี้รันได้เลยโดยไม่ต้อง export อะไร:"
echo "      cd api && dotnet run"
echo "      dotnet ef database update --project api"
echo
