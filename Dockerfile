FROM oven/bun:1.3.1 AS deps
WORKDIR /app

COPY package.json ./
RUN bun install

FROM oven/bun:1.3.1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3030

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3030
CMD ["node", "server.js"]
