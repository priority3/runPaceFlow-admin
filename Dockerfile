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

# ─────────────────────────────────────────────────────────────────────────────
# 关键:把「稳定且昂贵」的层(系统库 / ws / Chromium)放在「应用代码 COPY」之前。
# 这样改代码重建时,这些层能命中缓存 —— 不再每次重下 674MB Chromium、重装 ws,
# 既不卡网络也不让镜像每次多长 ~1.8GB(旧顺序里它们在 COPY 之后,代码一变就全部失效重造)。
# ─────────────────────────────────────────────────────────────────────────────

# Chromium 运行所需系统库(赛事匹配用 Playwright 启动 Chromium 爬 zuicool.com)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libatspi2.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libgtk-3-0 \
    libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxkbcommon0 libxrandr2 wget \
    && rm -rf /var/lib/apt/lists/*

# @libsql 运行时需要 ws(standalone 没打包)。在「空 node_modules」上装 → 层很小
# (旧顺序把它放在 COPY standalone 之后,会在大 node_modules 上 churn 出 ~1.1GB 的层);
# 之后的 COPY standalone 会合并 node_modules,ws 会保留。
# Reason: heyun 上 npm 会走 IPv6 卡死 → 用 npmmirror(有 IPv4)+ NODE_OPTIONS ipv4first + fail-fast。
RUN NODE_OPTIONS=--dns-result-order=ipv4first npm install ws --no-save --no-audit --no-fund \
      --registry=https://registry.npmmirror.com --fetch-timeout=60000 --fetch-retries=3 || \
    (npm init -y >/dev/null 2>&1 && \
     NODE_OPTIONS=--dns-result-order=ipv4first npm install ws --no-audit --no-fund \
       --registry=https://registry.npmmirror.com --fetch-timeout=60000 --fetch-retries=3)

# Playwright Chromium 到固定路径(稳定,放应用代码之前以便缓存)
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
RUN npx --yes playwright@1.61.0 install chromium

RUN mkdir -p /app/data

# ── 应用产物:每次都变,放最后 —— 只让这几层随代码失效 ──
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3030
CMD ["node", "server.js"]
