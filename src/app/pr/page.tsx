'use client'

import { useEffect, useRef, useState } from 'react'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

/**
 * PR 对话 H5(手机优先,GPT 式聊天窗口)。
 * 免登录:token 由每日 PushPlus 推送里的链接带入(?t=),存 localStorage 后续复用。
 * 直连 /api/pr/chat(带 Bearer token)——后端是多节点 Agent 编排(记忆/RAG/健康/Evaluator)。
 * 上传/拍摄为 Phase 2(先占位)。
 */
export default function PrChatPage() {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [authError, setAuthError] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // token(URL ?t= → localStorage)+ thread 初始化。Reason: 必须在 mount 后读浏览器 API,
  // 用惰性 initializer 会在 SSR 与客户端产生 hydration 不一致,所以在 effect 里同步 setState。
  useEffect(() => {
    const url = new URL(window.location.href)
    const t = url.searchParams.get('t')
    if (t) {
      localStorage.setItem('pr_chat_token', t)
      url.searchParams.delete('t')
      window.history.replaceState({}, '', url.pathname + url.search)
    }
    const nextToken = t || localStorage.getItem('pr_chat_token')
    const nextThread = localStorage.getItem('pr_chat_thread')
    /* eslint-disable react-hooks/set-state-in-effect */
    setToken(nextToken)
    setThreadId(nextThread)
    setReady(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  // 载入历史会话
  useEffect(() => {
    if (!token || !threadId) return
    void (async () => {
      try {
        const r = await fetch(`/api/pr/chat?threadId=${encodeURIComponent(threadId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (r.status === 401) { setAuthError(true); return }
        if (r.ok) {
          const j = await r.json()
          const msgs: Msg[] = (j.messages ?? [])
            .slice()
            .reverse()
            .map((m: { role: string; content: string }) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
          setMessages(msgs)
        }
      } catch {
        /* ignore load error */
      }
    })()
  }, [token, threadId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  async function send() {
    const text = input.trim()
    if (!text || sending || !token) return
    setInput('')
    setMessages(m => [...m, { role: 'user', content: text }])
    setSending(true)
    try {
      const r = await fetch('/api/pr/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, threadId }),
      })
      if (r.status === 401) { setAuthError(true); setSending(false); return }
      const j = await r.json()
      if (j.threadId && j.threadId !== threadId) {
        setThreadId(j.threadId)
        localStorage.setItem('pr_chat_thread', j.threadId)
      }
      setMessages(m => [...m, { role: 'assistant', content: j.answer ?? '(没有回复)' }])
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

  if (ready && !token) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-neutral-950 p-6 text-center text-neutral-300">
        <div>
          <div className="mb-2 text-2xl">🏃</div>
          <p className="text-sm">请从每日推送里的「打开 PR 对话」链接进入。</p>
          <p className="mt-1 text-xs text-neutral-500">(缺少访问令牌)</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-sm">🏃</span>
        <div>
          <div className="text-sm font-medium">PR · 你的跑步搭子</div>
          <div className="text-[11px] text-neutral-500">{sending ? '正在想…' : '在线'}</div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !sending && (
          <div className="mt-10 text-center text-sm text-neutral-500">
            <p>嗨,我是 PR。今天感觉怎么样?</p>
            <p className="mt-1 text-xs">聊聊训练、睡眠、状态,或者随便说说。</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-emerald-600 px-3.5 py-2 text-sm text-white'
                  : 'max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-neutral-800 px-3.5 py-2 text-sm text-neutral-100'
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-neutral-800 px-3.5 py-2 text-sm text-neutral-400">PR 正在想… ⏳</div>
          </div>
        )}
      </div>

      <div className="border-t border-white/10 px-3 py-2.5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
        <div className="flex items-end gap-2">
          <button
            type="button"
            disabled
            title="上传 / 拍摄即将支持"
            className="mb-0.5 shrink-0 rounded-full p-2 text-neutral-600"
          >
            📎
          </button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="和 PR 说点什么…"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl border border-white/10 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-500/50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            className="mb-0.5 shrink-0 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
