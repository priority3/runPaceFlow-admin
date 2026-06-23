import '@/styles/globals.css'

import type { Metadata } from 'next'

import { ToastProvider } from '@/components/ui/toast'

export const metadata: Metadata = {
  title: 'RunPaceFlow Admin',
  description: 'Configuration center for RunPaceFlow deployments',
}

const themeScript = `
  (function() {
    var stored = localStorage.getItem('theme');
    var theme = stored || 'system';
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  })();
`

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
