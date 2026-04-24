# ============================================================
# MyHealthSpan Agent — Container Image
# Personal health intelligence on your own infrastructure
#
# Build:  docker build -t myhealthspan-agent .
# Run:    docker run -p 3000:3000 -e XSPAN_API_KEY=... myhealthspan-agent
# ============================================================

FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Production stage ──────────────────────────────────────────
FROM node:22-alpine

LABEL org.opencontainers.image.title="MyHealthSpan Agent" \
      org.opencontainers.image.description="Personal health intelligence — wearables + medical records + labs" \
      org.opencontainers.image.vendor="XSpan.ai" \
      org.opencontainers.image.url="https://xspan.ai/agent" \
      org.opencontainers.image.source="https://github.com/karlmehta/XSpan-HealthAI-Agent" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# Copy built output from builder
COPY --from=builder /app/dist ./dist

# Copy runtime assets
COPY scripts/install.js ./scripts/install.js
COPY .env.example ./.env.example

# Create non-root user for security
RUN addgroup -g 1001 -S mhs && \
    adduser -S mhs -u 1001 -G mhs && \
    mkdir -p /home/mhs/.myhealthspan && \
    chown -R mhs:mhs /app /home/mhs/.myhealthspan

USER mhs

# Data persistence volume
VOLUME ["/home/mhs/.myhealthspan"]

# Dashboard port
EXPOSE 3000

# Health check — verify dashboard responds
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/status || exit 1

# Default: start web dashboard
CMD ["node", "dist/index.js", "serve"]
