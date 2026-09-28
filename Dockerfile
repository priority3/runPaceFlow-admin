# Reason: 整合所有已验证修复 —— bun 跑 .bin/next 找不到 require-hook(改用 node 跑 next),
# Turbopack 对 node-cron external 报 EISDIR(用 --webpack),@libsql 运行时缺 ws(runner 补装),
# 同步迁移后需 Playwright+Chromium 做赛事匹配(runner 装)。

# Stage 1: 单阶段 install+build(避免跨阶段 COPY bun node_modules 的 require-hook 问题)
FROM oven/bun:1.3.1 AS builder
WORKDIR /app
COPY package.json bun.lock ./

# 可选的 npm 镜像。默认留空 = 官方源,行为与之前完全一致(CI 的 checks 就是这样跑的);
# 服务器的 docker-compose.yml 传入国内镜像。
#
# Reason: bun 1.3.1 对锁文件里 registry 字段为 "" 的条目一律按官方源解析 —— --registry、
# BUN_CONFIG_REGISTRY、bunfig.toml、.npmrc 四种配置 09-28 逐一实测全部无效。所以只能
# 在构建时把 "" 就地补成镜像地址(格式与锁文件里已有的镜像条目一致)。只改下载地址:
#   - 版本不变:--frozen-lockfile 保证锁文件与 package.json 对不上就拒绝安装
#   - 内容不变:每个条目的 sha512 原样保留,bun 逐个校验,镜像给了不同文件会直接报错
# 仓库里的 bun.lock 本身不受影响。实测(上海服务器)官方源 429~777s,镜像 17s。
ARG NPM_MIRROR=
RUN if [ -n "$NPM_MIRROR" ]; then \
      sed -i -E 's#\["((@[^/"]+/)?([^@"]+))@([^"]+)", ""#["\1@\4", "'"$NPM_MIRROR"'/\1/-/\3-\4.tgz"#' bun.lock; \
    fi

# --ignore-scripts: 构建用 node 跑 next,不依赖任何 install 脚本;保留该 flag 也让
# 构建不受将来新增依赖的 postinstall 影响。
RUN bun install --ignore-scripts --frozen-lockfile
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
# 关键:把「稳定且昂贵」的层(ws)放在「应用代码 COPY」之前,改代码重建时能命中缓存。
# 注:此前这里还有 674MB Chromium 与 23 个 X11/GTK 系统库(赛事匹配曾用 Playwright),
# 已随 race-matcher 改为普通 fetch 一并下线。
# ─────────────────────────────────────────────────────────────────────────────

# @libsql 运行时需要 ws(standalone 没打包)。在「空 node_modules」上装 → 层很小
# (旧顺序把它放在 COPY standalone 之后,会在大 node_modules 上 churn 出 ~1.1GB 的层);
# 之后的 COPY standalone 会合并 node_modules,ws 会保留。
# Reason: heyun 上 npm 会走 IPv6 卡死 → 用 npmmirror(有 IPv4)+ NODE_OPTIONS ipv4first + fail-fast。
RUN NODE_OPTIONS=--dns-result-order=ipv4first npm install ws --no-save --no-audit --no-fund \
      --registry=https://registry.npmmirror.com --fetch-timeout=60000 --fetch-retries=3 || \
    (npm init -y >/dev/null 2>&1 && \
     NODE_OPTIONS=--dns-result-order=ipv4first npm install ws --no-audit --no-fund \
       --registry=https://registry.npmmirror.com --fetch-timeout=60000 --fetch-retries=3)

RUN mkdir -p /app/data

# ── 应用产物:每次都变,放最后 —— 只让这几层随代码失效 ──
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3030
CMD ["node", "server.js"]
