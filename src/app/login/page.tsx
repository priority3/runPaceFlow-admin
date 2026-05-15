import { redirect } from 'next/navigation'

import { LoginForm } from '@/components/login/LoginForm'
import { isAuthenticated } from '@/lib/auth'

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect('/')
  }

  return (
    <main className="bg-muted/40 flex min-h-dvh items-center justify-center px-4">
      <LoginForm />
    </main>
  )
}
