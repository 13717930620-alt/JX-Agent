# HyperAgent v5.0 — 多阶段构建
# 使用方式: docker build -t hyperagent . && docker run -p 3000:3000 hyperagent

# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ git

COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY . .

# ---- Production Stage ----
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tini curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

RUN mkdir -p /app/data /app/mem_store /app/logs /app/plugins /app/work_records

ENV NODE_ENV=production
ENV PORT=3000
ENV HYPERAGENT_DB_PATH=/app/data/hyperagent.db

VOLUME ["/app/data", "/app/mem_store", "/app/plugins"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "HyperAgent_Main.js", "server"]
