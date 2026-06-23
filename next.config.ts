import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Reason: 这些是 server-only 原生/重型包,让 Next 运行时直接 require,不打包进 bundle。
  // node-cron: 否则 turbopack/webpack 报 EISDIR;playwright: Chromium 启动需运行时 require;
  // @libsql/fast-xml-parser: 含原生/动态依赖,external 更稳。
  serverExternalPackages: ['node-cron', 'playwright', '@libsql/client', 'fast-xml-parser'],
}

export default nextConfig
