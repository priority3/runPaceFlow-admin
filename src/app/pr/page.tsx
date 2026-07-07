'use client'

import { useEffect, useRef, useState } from 'react'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string | null
}
interface Thread {
  id: string
  title: string
  summary: string | null
  lastMessageAt: string | null
}

/* 内联描边图标(项目未加载图标字体,统一用 currentColor 的极简 SVG,替代 emoji) */
type IconProps = { size?: number; className?: string }
const svgBase = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})
const MenuIcon = ({ size = 22, className }: IconProps) => (
  <svg {...svgBase(size)} className={className} aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
)
const PlusIcon = ({ size = 22, className }: IconProps) => (
  <svg {...svgBase(size)} className={className} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
)
const PaperclipIcon = ({ size = 22, className }: IconProps) => (
  <svg {...svgBase(size)} className={className} aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
)
const CameraIcon = ({ size = 22, className }: IconProps) => (
  <svg {...svgBase(size)} className={className} aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
)
const TrashIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgBase(size)} className={className} aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" /></svg>
)
const SendIcon = ({ size = 20, className }: IconProps) => (
  <svg {...svgBase(size)} className={className} aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
)
const CloseIcon = ({ size = 16, className }: IconProps) => (
  <svg {...svgBase(size)} className={className} aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
)
const Spinner = ({ size = 20, className }: IconProps) => (
  <svg {...svgBase(size)} className={`pr-spin ${className ?? ''}`} aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg>
)

/**
 * PR 对话 H5(手机优先,完整多会话 chat)。RunPaceFlow 品牌:黑白极简 + 荧光绿强调色 + 真实 logo。
 * 主题:作用域 CSS 变量(--pr-*),深色随系统自动切换(不依赖全局 shadcn 令牌)。
 * 免登录:token 由推送链接带入(?t=),存 localStorage。会话/消息都存服务端。
 * 直连 /api/pr/chat(Agent 编排)+ /api/pr/threads(会话列表/删除)+ 图片上传(视觉)。
 */
export default function PrChatPage() {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [authError, setAuthError] = useState(false)
  const [threads, setThreads] = useState<Thread[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const authHeader = (): HeadersInit => ({ Authorization: `Bearer ${token ?? ''}` })
  const imgSrc = (url: string) => `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(token ?? '')}`

  // token 初始化(mount 后读浏览器 API,避免 SSR hydration 不一致)
  useEffect(() => {
    const url = new URL(window.location.href)
    const t = url.searchParams.get('t')
    if (t) {
      localStorage.setItem('pr_chat_token', t)
      url.searchParams.delete('t')
      window.history.replaceState({}, '', url.pathname + url.search)
    }
    const nextToken = t || localStorage.getItem('pr_chat_token')
    /* eslint-disable react-hooks/set-state-in-effect */
    setToken(nextToken)
    setReady(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  // 拉会话列表 → 决定当前会话(本地存的优先,否则最近一条)。跨设备也能续上。
  useEffect(() => {
    if (!token) return
    void (async () => {
      const list = await fetchThreads()
      const stored = localStorage.getItem('pr_chat_thread')
      const pick = stored && list.some(t => t.id === stored) ? stored : (list[0]?.id ?? null)
      setThreadId(pick)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // 会话切换 → 载入该会话消息
  useEffect(() => {
    if (!token || !threadId) return
    void (async () => {
      try {
        const r = await fetch(`/api/pr/chat?threadId=${encodeURIComponent(threadId)}`, { headers: authHeader(), cache: 'no-store' })
        if (r.status === 401) { setAuthError(true); return }
        if (r.ok) {
          const j = await r.json()
          setMessages(
            (j.messages ?? [])
              .slice()
              .reverse()
              .map((m: { role: string; content: string; imageUrl?: string | null }) => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content,
                imageUrl: m.imageUrl ?? null,
              })),
          )
        }
      } catch {
        /* ignore */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, threadId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  async function fetchThreads(): Promise<Thread[]> {
    try {
      const r = await fetch('/api/pr/threads', { headers: authHeader(), cache: 'no-store' })
      if (r.status === 401) { setAuthError(true); return [] }
      if (!r.ok) return []
      const j = await r.json()
      const list: Thread[] = j.threads ?? []
      setThreads(list)
      return list
    } catch {
      return []
    }
  }

  function switchTo(id: string) {
    setDrawerOpen(false)
    if (id === threadId) return
    setMessages([])
    setThreadId(id)
    localStorage.setItem('pr_chat_thread', id)
  }

  function newChat() {
    setDrawerOpen(false)
    setThreadId(null)
    setMessages([])
    setPendingImageUrl(null)
    localStorage.removeItem('pr_chat_thread')
  }

  async function deleteThread(id: string) {
    if (!window.confirm('删除这个会话?')) return
    try {
      await fetch(`/api/pr/threads?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeader() })
    } catch {
      /* ignore */
    }
    const list = await fetchThreads()
    if (id === threadId) {
      const next = list[0]?.id ?? null
      setMessages([])
      setThreadId(next)
      if (next) localStorage.setItem('pr_chat_thread', next)
      else localStorage.removeItem('pr_chat_thread')
    }
  }

  async function uploadFile(file: File) {
    if (!token) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/pr/upload', { method: 'POST', headers: authHeader(), body: fd })
      const j = await r.json()
      if (!r.ok) { window.alert(j.error || '上传失败'); return }
      setPendingImageUrl(j.url)
    } catch {
      window.alert('上传失败,网络错误')
    } finally {
      setUploading(false)
    }
  }

  async function send() {
    const text = input.trim()
    if ((!text && !pendingImageUrl) || sending || uploading || !token) return
    const imageUrl = pendingImageUrl
    const isNew = !threadId
    setInput('')
    setPendingImageUrl(null)
    setMessages(m => [...m, { role: 'user', content: text, imageUrl }])
    setSending(true)
    try {
      const r = await fetch('/api/pr/chat', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, threadId, imageUrl }),
      })
      if (r.status === 401) { setAuthError(true); setSending(false); return }
      const j = await r.json()
      if (j.threadId && j.threadId !== threadId) {
        setThreadId(j.threadId)
        localStorage.setItem('pr_chat_thread', j.threadId)
      }
      setMessages(m => [...m, { role: 'assistant', content: j.answer ?? '(没有回复)' }])
      if (isNew) void fetchThreads() // 新会话 → 刷新列表让它出现
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: '网络出错了，稍后再试。' }])
    }
    setSending(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  function relTime(iso: string | null): string {
    if (!iso) return ''
    const d = new Date(iso)
    const diff = Date.now() - d.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (new Date().toDateString() === d.toDateString()) return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    return `${d.getMonth() + 1}-${d.getDate()}`
  }

  const canSend = (input.trim().length > 0 || !!pendingImageUrl) && !sending && !uploading

  if (ready && !token) {
    return (
      <div className="pr flex h-[100dvh] items-center justify-center p-6 text-center" style={{ background: 'var(--pr-bg)', color: 'var(--pr-text-2)' }}>
        <PrThemeStyle />
        <div>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: '#fff', border: '1px solid var(--pr-line-strong)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pr-logo.png" alt="RunPaceFlow" className="h-10 w-10" />
          </div>
          <p className="text-sm" style={{ color: 'var(--pr-text)' }}>请从每日推送里的「打开 PR 对话」链接进入。</p>
          <p className="mt-1.5 text-xs" style={{ color: 'var(--pr-muted)' }}>(缺少访问令牌)</p>
        </div>
      </div>
    )
  }

  const currentTitle = threads.find(t => t.id === threadId)?.title ?? (threadId ? 'PR 对话' : '新对话')

  return (
    <div className="pr flex h-[100dvh] flex-col" style={{ background: 'var(--pr-bg)', color: 'var(--pr-text)' }}>
      <PrThemeStyle />

      <header className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--pr-line)' }}>
        <button type="button" onClick={() => { void fetchThreads(); setDrawerOpen(true) }} className="pr-tap rounded-lg p-1.5" style={{ color: 'var(--pr-text-2)' }} aria-label="会话列表">
          <MenuIcon />
        </button>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: '#fff', border: '1px solid var(--pr-line-strong)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pr-logo.png" alt="RunPaceFlow" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium tracking-tight">{currentTitle}</div>
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--pr-muted)' }}>
            {sending ? (
              <>
                <span className="pr-dot-solid" style={{ background: 'var(--pr-accent)' }} />正在输入…
              </>
            ) : (
              <>
                <span className="pr-dot-solid" style={{ background: 'var(--pr-accent)' }} />PR · 你的跑步搭子
              </>
            )}
          </div>
        </div>
        <button type="button" onClick={newChat} className="pr-tap rounded-lg p-1.5" style={{ color: 'var(--pr-text-2)' }} aria-label="新对话">
          <PlusIcon />
        </button>
      </header>

      {/* 会话抽屉 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.35)' }} />
          <div className="pr absolute left-0 top-0 flex h-full w-72 flex-col" style={{ background: 'var(--pr-bg)', boxShadow: '2px 0 24px rgba(0,0,0,.18)' }} onClick={e => e.stopPropagation()}>
            <div className="p-3" style={{ borderBottom: '1px solid var(--pr-line)' }}>
              <button type="button" onClick={newChat} className="pr-tap flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium" style={{ background: 'var(--pr-user-bg)', color: 'var(--pr-user-text)' }}>
                <PlusIcon size={18} />新对话
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {threads.length === 0 && <p className="p-3 text-xs" style={{ color: 'var(--pr-muted)' }}>还没有会话</p>}
              {threads.map(t => {
                const active = t.id === threadId
                return (
                  <div
                    key={t.id}
                    className="pr-tap flex items-center gap-2 rounded-xl px-3 py-2.5"
                    style={{ background: active ? 'var(--pr-sel)' : 'transparent' }}
                  >
                    {active && <span className="shrink-0 pr-dot-solid" style={{ background: 'var(--pr-accent)' }} />}
                    <button type="button" onClick={() => switchTo(t.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-baseline gap-2">
                        <div className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--pr-text)' }}>{t.title}</div>
                        <div className="shrink-0 text-[10px]" style={{ color: 'var(--pr-muted)' }}>{relTime(t.lastMessageAt)}</div>
                      </div>
                      {t.summary && (
                        <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--pr-muted)' }}>{t.summary}</div>
                      )}
                    </button>
                    <button type="button" onClick={() => void deleteThread(t.id)} className="pr-tap shrink-0 p-1" style={{ color: 'var(--pr-muted)' }} aria-label="删除会话">
                      <TrashIcon />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5" style={{ background: 'var(--pr-area)' }}>
        {messages.length === 0 && !sending && (
          <div className="mx-auto mt-16 max-w-xs text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: '#fff', border: '1px solid var(--pr-line-strong)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/pr-logo.png" alt="" className="h-10 w-10" />
            </div>
            <p className="text-[15px] font-medium" style={{ color: 'var(--pr-text)' }}>嗨,我是 PR。</p>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--pr-text-2)' }}>今天感觉怎么样?聊聊训练、睡眠、状态,或者拍张跑鞋、风景给我看看。</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {messages.map((m, i) => {
            const isUser = m.role === 'user'
            if (isUser) {
              return (
                <div key={i} className="pr-msg flex justify-end">
                  <div className="max-w-[80%] overflow-hidden" style={{ background: 'var(--pr-user-bg)', color: 'var(--pr-user-text)', borderRadius: '16px 16px 5px 16px' }}>
                    {m.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgSrc(m.imageUrl)} alt="图片" className="block max-h-72 w-full object-cover" />
                    )}
                    {m.content && m.content !== '[图片]' && (
                      <div className="whitespace-pre-wrap break-words px-3.5 py-2.5 text-[15px] leading-relaxed">{m.content}</div>
                    )}
                  </div>
                </div>
              )
            }
            return (
              <div key={i} className="pr-msg flex items-end gap-2">
                <PrAvatar />
                <div className="max-w-[80%] overflow-hidden" style={{ background: 'var(--pr-ai-bg)', color: 'var(--pr-ai-text)', border: '1px solid var(--pr-line)', borderRadius: '16px 16px 16px 5px' }}>
                  {m.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imgSrc(m.imageUrl)} alt="图片" className="block max-h-72 w-full object-cover" />
                  )}
                  {m.content && m.content !== '[图片]' && (
                    <div className="whitespace-pre-wrap break-words px-3.5 py-2.5 text-[15px] leading-relaxed">{m.content}</div>
                  )}
                </div>
              </div>
            )
          })}

          {sending && (
            <div className="pr-msg flex items-end gap-2">
              <PrAvatar />
              <div className="flex items-center gap-1.5 px-4 py-3.5" style={{ background: 'var(--pr-ai-bg)', border: '1px solid var(--pr-line)', borderRadius: '16px 16px 16px 5px' }}>
                <span className="pr-dot" /><span className="pr-dot" /><span className="pr-dot" />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pt-2.5" style={{ background: 'var(--pr-bg)', borderTop: '1px solid var(--pr-line)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
        {authError && (
          <div className="mb-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--pr-sel)', color: 'var(--pr-text-2)' }}>
            登录已失效,请重新从推送链接进入。
          </div>
        )}
        {pendingImageUrl && (
          <div className="mb-2 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgSrc(pendingImageUrl)} alt="待发送" className="h-14 w-14 rounded-xl object-cover" style={{ border: '1px solid var(--pr-line-strong)' }} />
            <button type="button" onClick={() => setPendingImageUrl(null)} className="pr-tap flex items-center gap-1 rounded-full px-2 py-1 text-xs" style={{ color: 'var(--pr-text-2)', background: 'var(--pr-sel)' }}>
              <CloseIcon size={13} />移除
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.target.value = '' }} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.target.value = '' }} />
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={uploading || sending} className="pr-tap mb-1 shrink-0 rounded-full p-2 disabled:opacity-40" style={{ color: 'var(--pr-text-2)' }} aria-label="拍照">
            <CameraIcon />
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || sending} className="pr-tap mb-1 shrink-0 rounded-full p-2 disabled:opacity-40" style={{ color: 'var(--pr-text-2)' }} aria-label="上传图片">
            {uploading ? <Spinner /> : <PaperclipIcon />}
          </button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="和 PR 说点什么…"
            className="pr-input max-h-32 min-h-[42px] flex-1 resize-none rounded-3xl px-4 py-2.5 text-[15px] outline-none"
            style={{ background: 'var(--pr-area)', color: 'var(--pr-text)', border: '1px solid var(--pr-line)' }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className="pr-tap mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity"
            style={{ background: 'var(--pr-accent)', color: 'var(--pr-accent-ink)', opacity: canSend ? 1 : 0.35 }}
            aria-label="发送"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

/* PR 头像:白底圆形 + 黑色 logo,深浅色下都清晰 */
function PrAvatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: '#fff', border: '1px solid var(--pr-line-strong)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/pr-logo.png" alt="PR" style={{ width: 18, height: 18 }} />
    </div>
  )
}

/* 作用域主题变量 + 动画。深色随系统(prefers-color-scheme),不依赖全局 shadcn 令牌 */
function PrThemeStyle() {
  return (
    <style>{`
.pr{
  --pr-bg:#ffffff; --pr-area:#f5f5f6; --pr-text:#111114; --pr-text-2:#6b6b72;
  --pr-muted:#a3a3ac; --pr-line:#ececee; --pr-line-strong:#e0e0e3;
  --pr-ai-bg:#ffffff; --pr-ai-text:#111114; --pr-user-bg:#141417; --pr-user-text:#f7f7f8;
  --pr-accent:#a3e635; --pr-accent-ink:#1a2e05; --pr-sel:#f0f0f2;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){
  .pr{
    --pr-bg:#0b0b0d; --pr-area:#121214; --pr-text:#f2f2f4; --pr-text-2:#a0a0a8;
    --pr-muted:#6b6b73; --pr-line:#232327; --pr-line-strong:#2c2c31;
    --pr-ai-bg:#1a1a1e; --pr-ai-text:#f2f2f4; --pr-user-bg:#ededf0; --pr-user-text:#141417;
    --pr-accent:#a3e635; --pr-accent-ink:#16240a; --pr-sel:#1c1c20;
    color-scheme:dark;
  }
}
.pr .pr-input::placeholder{color:var(--pr-muted)}
.pr .pr-input:focus{border-color:var(--pr-line-strong)}
.pr .pr-tap{transition:background .15s,opacity .15s}
.pr .pr-tap:active{opacity:.6}
.pr-dot-solid{width:6px;height:6px;border-radius:9999px;display:inline-block}
.pr .pr-dot{width:6px;height:6px;border-radius:9999px;background:var(--pr-muted);display:inline-block;animation:prBounce 1.2s infinite ease-in-out}
.pr .pr-dot:nth-child(2){animation-delay:.15s}
.pr .pr-dot:nth-child(3){animation-delay:.3s}
@keyframes prBounce{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.pr-msg{animation:prIn .18s ease-out}
@keyframes prIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.pr-spin{animation:prSpin .8s linear infinite}
@keyframes prSpin{to{transform:rotate(360deg)}}
`}</style>
  )
}
