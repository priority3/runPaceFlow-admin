#!/usr/bin/env bash
# PR Agent 评测入口(推荐用这个,而不是直接 bun run.ts)。
#
# 为什么需要它:本机若装了 Claude Code 等工具,全局会带一堆 ANTHROPIC_* 环境变量
# (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_CUSTOM_HEADERS …)。
#   - bun --env-file 不会覆盖已存在的环境变量 → 你 env-file 里的网关 BASE_URL 会被本机的顶掉;
#   - ANTHROPIC_AUTH_TOKEN 会让 SDK 在 x-api-key 之外再塞 Authorization: Bearer → 网关 403。
# 所以这里在启动前先 unset 掉本机全局的 ANTHROPIC_*/OPENAI_*,再用 env-file 干净地注入评测凭据。
#
# 用法:
#   PR_EVAL_ENV=/path/to/creds.env scripts/eval/run.sh [--only=L4] [--smoke] [--case=id]
#   # 若模型网关只对某台服务器 IP 放行,可先起 SSH SOCKS 隧道 + 本地 HTTP 桥,再:
#   HTTPS_PROXY=http://127.0.0.1:8888 PR_EVAL_ENV=... scripts/eval/run.sh
set -uo pipefail

unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL \
      ANTHROPIC_VISION_MODEL ANTHROPIC_CUSTOM_HEADERS ANTHROPIC_DEFAULT_SONNET_MODEL \
      ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL \
      OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL 2>/dev/null || true

# thinking 模型(mimo)预算:默认给足 3000,避免只出 thinking、正文为空(可覆盖)。
export PR_CHAT_MAX_TOKENS="${PR_CHAT_MAX_TOKENS:-3000}"

# 多模态用例的图片目录(uploads.ts 模块加载时读)——与生产 /app/data/uploads 隔离。
export PR_UPLOAD_DIR="${PR_UPLOAD_DIR:-./data/eval-uploads}"

# PR_EVAL_PHOENIX=1 时评测 trace 打进 Phoenix 独立项目 pr-eval(与生产 pr-agent 分开)。
# 端点默认公网 phoenix.razet.me(Cloudflare 隧道,OTLP 带 PHOENIX_API_KEY Bearer 鉴权,
# key 由 env-file 提供);本机有 6006 端口转发时可覆盖为 http://127.0.0.1:6006。
if [[ "${PR_EVAL_PHOENIX:-}" == "1" ]]; then
  export PHOENIX_COLLECTOR_ENDPOINT="${PHOENIX_COLLECTOR_ENDPOINT:-https://phoenix.razet.me}"
fi

ENVFILE="${PR_EVAL_ENV:-.env.local}"
if [[ ! -f "$ENVFILE" ]]; then
  echo "[eval] env-file 不存在: $ENVFILE(用 PR_EVAL_ENV 指定含模型凭据的文件)" >&2
  exit 1
fi

cd "$(dirname "$0")/../.." || exit 1
exec bun --env-file="$ENVFILE" scripts/eval/run.ts "$@"
