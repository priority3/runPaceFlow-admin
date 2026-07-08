/** Next.js 启动钩子:仅 Node 运行时初始化 OpenTelemetry(edge 不加载 OTel SDK)。 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // tracing 初始化任何失败都不能拖垮服务:观测是附加能力,降级为"无 tracing"即可。
  try {
    const { initOtel } = await import('./lib/observability/otel')
    initOtel()
  } catch (error) {
    console.warn('[otel] 初始化失败,tracing 关闭:', (error as Error).message)
  }
}
