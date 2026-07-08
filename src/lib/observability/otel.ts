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
  console.log(`[otel] tracing 已启用 → ${endpoint} (project: ${project})`)
}
