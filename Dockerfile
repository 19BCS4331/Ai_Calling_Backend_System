# ============================================
# VOCAAI Voice Backend - Production Dockerfile
# Multi-stage build for optimized image size
# ============================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Add non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S vocaai -u 1001 -G nodejs

# Install runtime dependencies only
RUN apk add --no-cache tini

# Copy built files from builder
COPY --from=builder --chown=vocaai:nodejs /app/dist ./dist
COPY --from=builder --chown=vocaai:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=vocaai:nodejs /app/package.json ./

# Copy static files if any (optional)
# COPY --chown=vocaai:nodejs public/ ./public/

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Expose ports
# 8080 - Voice API (WebSocket + HTTP)
# 3001 - SaaS API (REST)
EXPOSE 8080 3001

# Use non-root user
USER vocaai

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
