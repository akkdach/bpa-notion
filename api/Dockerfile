# ═══════════════════════════════════════════════════════════════════════════
#  ProjectManagementAPI — multi-stage build
# ═══════════════════════════════════════════════════════════════════════════

# ─── Stage 1: restore + publish ────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build

WORKDIR /src

# copy csproj ก่อน แล้ว restore — layer นี้ cache ได้ตราบใดที่ dependency ไม่เปลี่ยน
COPY ProjectManagementAPI.csproj ./
RUN dotnet restore

COPY . .
RUN dotnet publish ProjectManagementAPI.csproj \
        --configuration Release \
        --no-restore \
        --output /app/publish \
        /p:UseAppHost=false

# ─── Stage 2: runtime ──────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime

WORKDIR /app

# wget สำหรับ healthcheck ใน docker-compose (aspnet image ไม่มี curl มาให้)
RUN apt-get update \
 && apt-get install --no-install-recommends -y wget \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/publish .

# uploads เป็น volume mount — สร้างไว้ก่อนแล้วโอนสิทธิ์ให้ non-root user
RUN mkdir -p /app/uploads && chown -R app:app /app

# ⚠️ รันเป็น non-root — image นี้มี user `app` (uid 1654) มาให้แล้ว
USER app

ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_gcServer=1

EXPOSE 8080

ENTRYPOINT ["dotnet", "ProjectManagementAPI.dll"]
