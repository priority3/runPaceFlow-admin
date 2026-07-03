# Reason: 整合所有已验证修复 —— bun 跑 .bin/next 找不到 require-hook(改用 node 跑 next),
# Turbopack 对 node-cron external 报 EISDIR(用 --webpack),@libsql 运行时缺 ws(runner 补装),
# 同步迁移后需 Playwright+Chromium 做赛事匹配(runner 装)。

# Stage 1: 单阶段 install+build(避免跨阶段 COPY bun node_modules 的 require-hook 问题)
FROM oven/bun:1.3.1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
# --ignore-scripts: 跳过 esbuild(drizzle-kit 传递依赖)的 postinstall 二进制校验(bun 下会失败);
# 构建用 node 跑 next,不依赖 install 脚本。
RUN bun install --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# 用 node 跑 next(绕开 bun require-hook bug),webpack 构建(绕开 turbopack node-cron EISDIR)
RUN node node_modules/next/dist/bin/next build --webpack

# Stage 2: runner(node + Playwright/Chromium)
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3030
ENV HOSTNAME="0.0.0.0"

# Chromium 运行所需系统库(赛事匹配用 Playwright 启动 Chromium 爬 zuicool.com)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libatspi2.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libgtk-3-0 \
    libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxkbcommon0 libxrandr2 wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# @libsql 运行时需要 ws(standalone 没打包)
# Reason: registry.npmjs.org 在本机(heyun/国内)只有 AAAA 记录,npm 走 IPv6 会长时间卡死;
# 改用 npmmirror 镜像(有 IPv4、国内快),并设置 fetch 超时/重试,避免构建挂在这一步。
RUN npm install ws --no-save --no-audit --no-fund \
      --registry=https://registry.npmmirror.com --fetch-timeout=120000 --fetch-retries=5 2>/dev/null || \
    (npm init -y >/dev/null 2>&1 && \
     npm install ws --no-audit --no-fund --registry=https://registry.npmmirror.com --fetch-timeout=120000)
# 装 Playwright Chromium 到固定路径
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
RUN npx --yes playwright@1.61.0 install chromium

RUN mkdir -p /app/data

EXPOSE 3030
CMD ["node", "server.js"]
