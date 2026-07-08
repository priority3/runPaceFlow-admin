/**
 * OpenTelemetry 初始化(由 src/instrumentation.ts 在 Node 服务启动时调用一次)。
 *
 * 导出到 Arize Phoenix(OTLP http/protobuf,端点 ${PHOENIX_COLLECTOR_ENDPOINT}/v1/traces)。
 * 未配置 PHOENIX_COLLECTOR_ENDPOINT 时不注册 provider——@opentelemetry/api 全局退化为
 * no-op tracer,业务里的 withSpan 零开销直通,所以埋点代码不需要任何开关判断。
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

import { setTracingEnabled } from './trace'

export function initOtel() {
  const endpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT
  if (!endpoint) {
    console.log('[otel] PHOENIX_COLLECTOR_ENDPOINT 未配置,tracing 关闭')
    return
  }
  const project = process.env.PHOENIX_PROJECT_NAME || 'pr-agent'
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'runpaceflow-admin',
      // Phoenix 按这个 resource 属性把 trace 归到对应 project
      'openinference.project.name': project,
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
      ),
    ],
  })
  provider.register()
  setTracingEnabled()

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
