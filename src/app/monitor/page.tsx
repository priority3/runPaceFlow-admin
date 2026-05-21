import { redirect } from 'next/navigation'

import { isAuthenticated } from '@/lib/auth'
import { getMonitorData } from '@/lib/monitor'

import { MonitorDashboard } from './MonitorDashboard'

export const dynamic = 'force-dynamic'

export default async function MonitorPage() {
  if (!(await isAuthenticated())) {
    redirect('/login')
  }

  const data = await getMonitorData()

  return <MonitorDashboard initialData={data} />
}
