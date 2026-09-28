/** Next.js 启动钩子:仅 Node 运行时初始化 OpenTelemetry 与定时任务(edge 两者都不加载)。 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // tracing 初始化任何失败都不能拖垮服务:观测是附加能力,降级为"无 tracing"即可。
  try {
    const { initOtel } = await import('./lib/observability/otel')
    initOtel()
  } catch (error) {
    console.warn('[otel] 初始化失败,tracing 关闭:', (error as Error).message)
  }

  /**
   * 定时任务:进程启动即注册,不再依赖外部请求。
   *
   * Reason: 此前唯一的启动点是 GET /api/health 里的懒启动。走 CI 部署时那一步的
   * 探活顺手把它带起来了,所以一直没暴露;但 2026-09-12 手工 docker restart 之后
   * 无人请求 health,6 个 job 全部静默失效 —— 直到 09-28 才发现运动数据 16 天没同步。
   * 「容器活着但定时任务全死」且无任何报错,是这个懒启动最危险的地方。
   *
   * 先 ensureSchema 再启动,顺序与 health 那处一致:setupJobs 要读 scheduler_jobs 表。
   * 失败只告警不抛:定时任务起不来不该连带 HTTP 服务一起挂掉。
   */
  try {
    const { ensureSchema } = await import('./lib/db')
    const { startScheduler } = await import('./lib/scheduler')
    await ensureSchema()
    await startScheduler()
  } catch (error) {
    console.warn('[scheduler] 启动失败,定时任务未注册:', (error as Error).message)
  }
}
