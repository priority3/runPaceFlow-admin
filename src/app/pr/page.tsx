'use client'

import { useEffect, useRef, useState } from 'react'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string | null
}

/**
 * PR 对话 H5(手机优先,GPT 式聊天窗口)。RunPaceFlow 品牌:黑白极简 + 真实 logo。
 * 免登录:token 由每日 PushPlus 推送里的链接带入(?t=),存 localStorage 复用。
 * 直连 /api/pr/chat(Bearer token)——后端是多节点 Agent 编排(记忆/RAG/健康/Evaluator)。
 * Phase 2:支持上传/拍摄图片(视觉),后端网关已验证可看图。
 */
export default function PrChatPage() {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null)
  const [authError, setAuthError] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const imgSrc = (url: string) => `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(token ?? '')}`

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
            .map((m: { role: string; content: string; imageUrl?: string | null }) => ({
              role: m.role === 'assistant' ? 'assistant' : 'user',
              content: m.content,
              imageUrl: m.imageUrl ?? null,
            }))
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

  async function uploadFile(file: File) {
    if (!token) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/pr/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
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
    setInput('')
    setPendingImageUrl(null)
    setMessages(m => [...m, { role: 'user', content: text, imageUrl }])
    setSending(true)
    try {
      const r = await fetch('/api/pr/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, threadId, imageUrl }),
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

  function renderBubble(m: Msg, i: number) {
    const isUser = m.role === 'user'
    return (
      <div key={i} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
        <div
          className={
            isUser
              ? 'max-w-[82%] overflow-hidden rounded-2xl rounded-br-sm bg-neutral-900 text-white'
              : 'max-w-[82%] overflow-hidden rounded-2xl rounded-bl-sm border border-neutral-200 bg-white text-neutral-900'
          }
        >
          {m.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgSrc(m.imageUrl)} alt="上传的图片" className="block max-h-72 w-full object-cover" />
          )}
          {m.content && m.content !== '[图片]' && (
            <div className="whitespace-pre-wrap break-words px-3.5 py-2 text-sm">{m.content}</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-white text-neutral-900">
      <header className="flex items-center gap-2.5 border-b border-neutral-200 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pr-logo.png" alt="RunPaceFlow" className="h-8 w-8" />
        <div>
          <div className="text-sm font-semibold tracking-tight">PR · 你的跑步搭子</div>
          <div className="text-[11px] text-neutral-400">{sending ? '正在想…' : 'RunPaceFlow'}</div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-neutral-50 px-4 py-4">
        {messages.length === 0 && !sending && (
          <div className="mt-12 text-center text-sm text-neutral-400">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pr-logo.png" alt="" className="mx-auto mb-3 h-12 w-12 opacity-80" />
            <p className="text-neutral-600">嗨,我是 PR。今天感觉怎么样?</p>
            <p className="mt-1 text-xs">聊聊训练、睡眠、状态,或者拍张跑鞋/风景给我看看。</p>
          </div>
        )}
        {messages.map(renderBubble)}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-neutral-200 bg-white px-3.5 py-2 text-sm text-neutral-400">
              PR 正在想… ⏳
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-neutral-200 bg-white px-3 py-2.5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
        {pendingImageUrl && (
          <div className="mb-2 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgSrc(pendingImageUrl)} alt="待发送" className="h-14 w-14 rounded-lg border border-neutral-200 object-cover" />
            <button type="button" onClick={() => setPendingImageUrl(null)} className="text-xs text-neutral-400 underline">
              移除
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void uploadFile(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || sending}
            title="上传 / 拍照"
            className="mb-0.5 shrink-0 rounded-full p-2 text-lg text-neutral-500 hover:text-neutral-900 disabled:opacity-40"
          >
            {uploading ? '⏳' : '📎'}
          </button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="和 PR 说点什么…"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl border border-neutral-300 bg-white px-3.5 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-900"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={(!input.trim() && !pendingImageUrl) || sending || uploading}
            className="mb-0.5 shrink-0 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-30"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
