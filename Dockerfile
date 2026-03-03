FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies first (separate layer for better cache reuse)
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Build/run stage
FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Run database migrations then start the server.
# Migrations are a one-off admin process (12-Factor XII) but we run them here
# on container boot for simplicity. Move to a separate job in production.
CMD ["sh", "-c", "bunx drizzle-kit migrate && bun run src/index.ts"]
