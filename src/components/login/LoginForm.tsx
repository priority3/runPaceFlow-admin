'use client'

import { useActionState } from 'react'

import { loginAction } from '@/app/actions'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, null)

  return (
    // 登录卡是全站少数"独立、可整体操作"的东西,给它一张面;其余页面一律裸内容
    <section className="pr-surface w-full max-w-sm p-7">
      <div className="mb-8">
        <h1 className="text-lg font-medium">RunPaceFlow Admin</h1>
        <p className="pr-meta mt-1">登录配置中心</p>
      </div>

      <form action={formAction} className="space-y-4">
        <label htmlFor="admin-password" className="block">
          <span className="pr-label mb-2 block">管理密码</span>
          <input
            id="admin-password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            aria-invalid={state?.error ? true : undefined}
            aria-describedby={state?.error ? 'login-error' : undefined}
            className="pr-field h-11 w-full px-3 outline-none"
          />
        </label>

        {/* 错误双信号:字段描边变警示色 + 下方一行 11px 红字,不做整块底色 */}
        {state?.error && (
          <p id="login-error" role="alert" className="text-xs" style={{ color: 'var(--pr-danger)' }}>
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="pr-btn pr-btn-primary h-11 w-full"
        >
          {pending ? '登录中...' : '登录'}
        </button>
      </form>
    </section>
  )
}
