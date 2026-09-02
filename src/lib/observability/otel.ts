/**
 * OpenTelemetry 初始化(由 src/instrumentation.ts 在 Node 服务启动时调用一次)。
 *
 * 导出到 Arize Phoenix(OTLP http/protobuf,端点 ${PHOENIX_COLLECTOR_ENDPOINT}/v1/traces)。
 * 未配置 PHOENIX_COLLECTOR_ENDPOINT 时不注册 provider——@opentelemetry/api 全局退化为
 * no-op tracer,零开销。
 *
 * 说明:admin 侧自有的 withSpan 埋点已随 lib/pr 抽离(owner 在 pr-agent),
 * 这里保留 provider 注册是为了让 Next.js 框架级 span(路由/渲染)仍能上报。
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

export function initOtel() {
  const endpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT
  if (!endpoint) {
    console.log('[otel] PHOENIX_COLLECTOR_ENDPOINT 未配置,tracing 关闭')
    return
  }
  const project = process.env.PHOENIX_PROJECT_NAME || 'pr-agent'
  // Phoenix 开鉴权后,OTLP 摄取也要带 key(用 PHOENIX_ADMIN_SECRET 作系统 key);未开鉴权则留空。
  const apiKey = process.env.PHOENIX_API_KEY
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'runpaceflow-admin',
      // Phoenix 按这个 resource 属性把 trace 归到对应 project
      'openinference.project.name': project,
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
          ...(apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : {}),
        }),
      ),
    ],
  })
  provider.register()

  // BatchSpanProcessor 默认缓冲 5s;部署/重启频繁,不 flush 会丢掉在途 span。
  // Reason: 收到终止信号时先 shutdown(会 flush)再退出,保住最后几条 trace。
  let shuttingDown = false
  const flushAndExit = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    provider
      .shutdown()
      .catch(error => console.warn('[otel] shutdown flush 失败:', (error as Error).message))
      .finally(() => process.kill(process.pid, signal))
  }
  process.once('SIGTERM', flushAndExit)
  process.once('SIGINT', flushAndExit)
  console.log(`[otel] tracing 已启用 → ${endpoint} (project: ${project})`)
}
