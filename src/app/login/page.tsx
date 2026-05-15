import { redirect } from 'next/navigation'

import { LoginForm } from '@/components/login/LoginForm'
import { isAuthenticated } from '@/lib/auth'

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect('/')
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f5f7f8] px-4">
      <LoginForm />
    </main>
  )
}
