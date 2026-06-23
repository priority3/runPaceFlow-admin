'use client'

import { LockKeyhole } from 'lucide-react'
import { useActionState } from 'react'

import { loginAction } from '@/app/actions'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, null)

  return (
    <section className="bg-card text-card-foreground w-full max-w-sm rounded-lg border p-6 shadow-sm">
      <div className="mb-7 flex items-center gap-3">
        <span className="bg-primary text-primary-foreground flex h-10 w-10 items-center justify-center rounded-md">
          <LockKeyhole className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">RunPaceFlow Admin</h1>
          <p className="text-muted-foreground text-sm">登录配置中心</p>
        </div>
      </div>

      <form action={formAction} className="space-y-4">
        <label htmlFor="admin-password" className="block">
          <span className="text-muted-foreground mb-2 block text-sm">管理密码</span>
          <input
            id="admin-password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            aria-invalid={state?.error ? true : undefined}
            aria-describedby={state?.error ? 'login-error' : undefined}
            className="border-input bg-background placeholder:text-muted-foreground focus:border-ring focus:ring-ring/20 h-11 w-full rounded-md border px-3 outline-none transition-colors focus:ring-[3px]"
          />
        </label>

        {state?.error && (
          <p id="login-error" role="alert" className="bg-destructive/10 text-destructive rounded-md border border-destructive/20 px-3 py-2 text-sm">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-11 w-full items-center justify-center rounded-md text-sm font-medium shadow-sm transition-colors disabled:opacity-50"
        >
          {pending ? '登录中...' : '登录'}
        </button>
      </form>
    </section>
  )
}
