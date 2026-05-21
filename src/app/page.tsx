import { redirect } from 'next/navigation'

import { DashboardView } from '@/app/dashboard/DashboardView'
import { isAuthenticated } from '@/lib/auth'
import { listSettings } from '@/lib/store'

export default async function HomePage() {
  if (!(await isAuthenticated())) {
    redirect('/login')
  }

  const settings = await listSettings()

  return <DashboardView settings={settings} />
}
