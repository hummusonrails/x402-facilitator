# Multi-stage build for x402 facilitator
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy package files
COPY package.json ./

# Install dependencies
RUN pnpm install

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript
RUN pnpm build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Create non-root user
RUN addgroup -g 1001 -S facilitator && \
    adduser -S facilitator -u 1001

# Copy package files and install production dependencies only
COPY package.json ./
RUN pnpm install --prod

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Change ownership to non-root user
RUN chown -R facilitator:facilitator /app

# Switch to non-root user
USER facilitator

# Expose port (Fly.io will set PORT env var)
EXPOSE 8080

# Start the application
CMD ["node", "dist/server.js"]
