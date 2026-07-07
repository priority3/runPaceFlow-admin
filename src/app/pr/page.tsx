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
  lastMessageAt: string | null
}

/**
 * PR 对话 H5(手机优先,完整多会话 chat)。RunPaceFlow 品牌:黑白极简 + 真实 logo。
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

  if (ready && !token) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-white p-6 text-center text-neutral-700">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pr-logo.png" alt="RunPaceFlow" className="mx-auto mb-3 h-14 w-14" />
          <p className="text-sm">请从每日推送里的「打开 PR 对话」链接进入。</p>
          <p className="mt-1 text-xs text-neutral-400">(缺少访问令牌)</p>
        </div>
      </div>
    )
  }

  const currentTitle = threads.find(t => t.id === threadId)?.title ?? (threadId ? 'PR 对话' : '新对话')

  return (
    <div className="flex h-[100dvh] flex-col bg-white text-neutral-900">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-3">
        <button type="button" onClick={() => { void fetchThreads(); setDrawerOpen(true) }} className="rounded-lg p-1.5 text-neutral-600 hover:bg-neutral-100" title="会话">
          <span className="block text-lg leading-none">☰</span>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pr-logo.png" alt="RunPaceFlow" className="h-7 w-7" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">{currentTitle}</div>
          <div className="text-[11px] text-neutral-400">{sending ? '正在想…' : 'PR · RunPaceFlow'}</div>
        </div>
        <button type="button" onClick={newChat} className="rounded-lg px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100" title="新对话">＋</button>
      </header>

      {/* 会话抽屉 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute left-0 top-0 flex h-full w-72 flex-col bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-neutral-200 p-3">
              <button type="button" onClick={newChat} className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white">＋ 新对话</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {threads.length === 0 && <p className="p-3 text-xs text-neutral-400">还没有会话</p>}
              {threads.map(t => (
                <div
                  key={t.id}
                  className={`group flex items-center gap-2 rounded-lg px-3 py-2 ${t.id === threadId ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                >
                  <button type="button" onClick={() => switchTo(t.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm text-neutral-800">{t.title}</div>
                    <div className="text-[11px] text-neutral-400">{relTime(t.lastMessageAt)}</div>
                  </button>
                  <button type="button" onClick={() => void deleteThread(t.id)} className="shrink-0 text-neutral-300 hover:text-rose-500" title="删除">🗑</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-neutral-50 px-4 py-4">
        {messages.length === 0 && !sending && (
          <div className="mt-12 text-center text-sm text-neutral-400">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pr-logo.png" alt="" className="mx-auto mb-3 h-12 w-12 opacity-80" />
            <p className="text-neutral-600">嗨,我是 PR。今天感觉怎么样?</p>
            <p className="mt-1 text-xs">聊聊训练、睡眠、状态,或者拍张跑鞋/风景给我看看。</p>
          </div>
        )}
        {messages.map((m, i) => {
          const isUser = m.role === 'user'
          return (
            <div key={i} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
              <div className={isUser ? 'max-w-[82%] overflow-hidden rounded-2xl rounded-br-sm bg-neutral-900 text-white' : 'max-w-[82%] overflow-hidden rounded-2xl rounded-bl-sm border border-neutral-200 bg-white text-neutral-900'}>
                {m.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imgSrc(m.imageUrl)} alt="图片" className="block max-h-72 w-full object-cover" />
                )}
                {m.content && m.content !== '[图片]' && (
                  <div className="whitespace-pre-wrap break-words px-3.5 py-2 text-sm">{m.content}</div>
                )}
              </div>
            </div>
          )
        })}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-neutral-200 bg-white px-3.5 py-2 text-sm text-neutral-400">PR 正在想… ⏳</div>
          </div>
        )}
      </div>

      <div className="border-t border-neutral-200 bg-white px-3 py-2.5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
        {pendingImageUrl && (
          <div className="mb-2 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgSrc(pendingImageUrl)} alt="待发送" className="h-14 w-14 rounded-lg border border-neutral-200 object-cover" />
            <button type="button" onClick={() => setPendingImageUrl(null)} className="text-xs text-neutral-400 underline">移除</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.target.value = '' }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || sending} title="上传 / 拍照" className="mb-0.5 shrink-0 rounded-full p-2 text-lg text-neutral-500 hover:text-neutral-900 disabled:opacity-40">
            {uploading ? '⏳' : '📎'}
          </button>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown} rows={1} placeholder="和 PR 说点什么…" className="max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl border border-neutral-300 bg-white px-3.5 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-900" />
          <button type="button" onClick={() => void send()} disabled={(!input.trim() && !pendingImageUrl) || sending || uploading} className="mb-0.5 shrink-0 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-30">发送</button>
        </div>
      </div>
    </div>
  )
}
