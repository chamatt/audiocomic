#!/usr/bin/env bash
set -euo pipefail

# AudioComic dev script — kill all servers and restart fresh.
# Usage: ./dev.sh [--stop]
#   --stop   Kill all servers (no restart)

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ "${1:-}" == "--stop" ]]; then
  echo "│ Stopping all servers..."
  lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti :6420 2>/dev/null | xargs kill -9 2>/dev/null || true
  docker-compose stop postgres minio 2>/dev/null || true
  echo "✓ All stopped"
  exit 0
fi

echo "│ Stopping existing servers..."
lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti :6420 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1
echo "✓ Servers stopped"

echo "│ Starting Docker services (Postgres + MinIO)..."
docker-compose up -d postgres minio
echo "✓ Docker services started"

# Wait for Postgres to be healthy
echo "│ Waiting for Postgres..."
for i in $(seq 1 15); do
  if docker exec audiocomic-postgres pg_isready -U audiocomic -d audiocomic 2>/dev/null; then
    echo "✓ Postgres ready"
    break
  fi
  sleep 1
done

# Wait for MinIO to be healthy
echo "│ Waiting for MinIO..."
for i in $(seq 1 15); do
  if curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; then
    echo "✓ MinIO ready"
    break
  fi
  sleep 1
done

# Create MinIO bucket if it doesn't exist
echo "│ Ensuring MinIO bucket 'audiocomic' exists..."
docker exec audiocomic-minio mc alias set local http://localhost:9000 audiocomic audiocomic-dev >/dev/null 2>&1 || true
docker exec audiocomic-minio mc mb local/audiocomic >/dev/null 2>&1 || true
echo "✓ MinIO bucket ready"

# Run database migrations
echo "│ Running database migrations..."
cd packages/db && npx tsx src/migrate.ts 2>&1 | tail -1
cd "$ROOT"
echo "✓ Migrations done"

# Start actor server (background, with STORAGE_USE_LOCAL unset so it uses MinIO)
# dotenv-cli loads .env explicitly (tsx doesn't auto-load like Next.js does)
echo "│ Starting actor server on :6420..."
STORAGE_USE_LOCAL= RIVET_RUN_ENGINE=1 npx dotenv -e .env -- npx tsx packages/actors/src/server/main.ts > /tmp/audiocomic-actor.log 2>&1 &
ACTOR_PID=$!
echo "✓ Actor server started (PID $ACTOR_PID, logs: /tmp/audiocomic-actor.log)"

# Wait for actor server to be ready
for i in $(seq 1 15); do
  if lsof -ti :6420 >/dev/null 2>&1; then
    echo "✓ Actor server listening"
    break
  fi
  sleep 1
done

# Start web app (background, with STORAGE_USE_LOCAL unset)
echo "│ Starting web app on :3000..."
cd apps/web && STORAGE_USE_LOCAL= npx next dev > /tmp/audiocomic-web.log 2>&1 &
WEB_PID=$!
cd "$ROOT"
echo "✓ Web app started (PID $WEB_PID, logs: /tmp/audiocomic-web.log)"

# Wait for web app to be ready
for i in $(seq 1 30); do
  if lsof -ti :3000 >/dev/null 2>&1; then
    echo "✓ Web app listening"
    break
  fi
  sleep 1
done

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  AudioComic is running!                              ║"
echo "║                                                      ║"
echo "║  Web app:     http://localhost:3000                  ║"
echo "║  Actor API:   http://localhost:6420                  ║"
echo "║  MinIO console: http://localhost:9001                ║"
echo "║  Postgres:    localhost:5432                         ║"
echo "║                                                      ║"
echo "║  Logs:                                               ║"
echo "║    Actor: tail -f /tmp/audiocomic-actor.log          ║"
echo "║    Web:   tail -f /tmp/audiocomic-web.log            ║"
echo "║                                                      ║"
echo "║  Stop: ./dev.sh --stop                               ║"
echo "╚══════════════════════════════════════════════════════╝"
