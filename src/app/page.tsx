import { redirect } from 'next/navigation'

import { Dashboard } from '@/components/dashboard/Dashboard'
import { isAuthenticated } from '@/lib/auth'
import { listSettings } from '@/lib/store'

export default async function HomePage() {
  if (!(await isAuthenticated())) {
    redirect('/login')
  }

  const settings = await listSettings()

  return <Dashboard settings={settings} />
}
