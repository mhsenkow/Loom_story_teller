# =================================================================
# Loom — Docker Image (Web UI only, no Tauri shell)
# =================================================================
# Builds the Next.js static export and serves it via a minimal
# Node.js server. Use this for sharing/deploying chart stories
# or for frontend development without Rust.
#
# Usage:
#   make shuttle        (docker compose up)
#   make shuttle-build  (build only)
# =================================================================

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY . .
RUN npm run build

# --- Serve stage ---
FROM node:22-alpine AS runner

WORKDIR /app

RUN npm install -g serve@14

COPY --from=builder /app/out ./out

EXPOSE 3000

CMD ["serve", "out", "-l", "3000", "-s"]
