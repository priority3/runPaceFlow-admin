import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * 旧 H5 对话页的去向:整体搬去 pr-agent,这里只保留跳转。
 *
 * Reason: 历史推送链接与手机书签都指向本站 /pr?t=<token>(通知正文由
 * NEXT_PUBLIC_ADMIN_URL 拼出),直接删页面会让这些链接 404。保留一个跳转壳子,
 * 原样带上查询串(含 t=),用户无感;等推送链接全部换成 pr-agent 地址后可以再删。
 */
export default async function PrChatRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const base = (process.env.NEXT_PUBLIC_PR_AGENT_URL ?? '').replace(/\/$/, '')

  if (!base) {
    return (
      <main className="mx-auto max-w-md p-8 text-sm leading-relaxed">
        <h1 className="mb-3 text-base font-semibold">对话页已搬到 pr-agent</h1>
        <p className="text-muted-foreground">
          本站未配置 <code className="bg-muted rounded px-1">NEXT_PUBLIC_PR_AGENT_URL</code>,
          无法自动跳转。请在容器环境变量里填上 pr-agent 的公网地址后重启。
        </p>
      </main>
    )
  }

  // 原样透传查询串:t=<PR_CHAT_TOKEN> 是免登录进入对话页的钥匙,丢了就要重新拿。
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(key, value)
    else if (Array.isArray(value) && value[0] != null) params.set(key, value[0])
  }

  const query = params.toString()
  redirect(`${base}/pr${query ? `?${query}` : ''}`)
}
