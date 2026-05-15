'use client'

import { LockKeyhole } from 'lucide-react'
import { useActionState } from 'react'

import { loginAction } from '@/app/actions'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, null)

  return (
    <section className="w-full max-w-sm rounded-lg border border-[#d7dee4] bg-white p-6 shadow-sm">
      <div className="mb-7 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e0f4f1] text-[#0f766e]">
          <LockKeyhole className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-[#172026]">RunPaceFlow Admin</h1>
          <p className="text-sm text-[#5d6975]">登录配置中心</p>
        </div>
      </div>

      <form action={formAction} className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm text-[#5d6975]">管理密码</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            className="h-11 w-full rounded-lg border border-[#cfd8df] bg-white px-3 text-[#172026] outline-none transition focus:border-[#0f766e] focus:ring-4 focus:ring-[#0f766e]/15"
          />
        </label>

        {state?.error && (
          <p className="rounded-lg bg-[#fff1f0] px-3 py-2 text-sm text-[#b42318]">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="flex h-11 w-full items-center justify-center rounded-lg bg-[#0f766e] text-sm font-medium text-white transition hover:bg-[#115e59] disabled:opacity-50"
        >
          {pending ? '登录中...' : '登录'}
        </button>
      </form>
    </section>
  )
}
