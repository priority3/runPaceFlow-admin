import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Reason: 这些是 server-only 原生/重型包,让 Next 运行时直接 require,不打包进 bundle。
  // node-cron: 否则 turbopack/webpack 报 EISDIR;
  // @libsql/fast-xml-parser: 含原生/动态依赖,external 更稳。
  serverExternalPackages: [
    'node-cron',
    '@libsql/client',
    'fast-xml-parser',
    // OTel/Phoenix tracing: 含原生/protobuf 依赖,让运行时直接 require,不进 webpack bundle
    '@opentelemetry/api',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/exporter-trace-otlp-proto',
  ],
  async headers() {
    return [
      {
        // persona 3D 模型(13MB VRM):默认 max-age=0 且 CF 不缓存 .vrm(DYNAMIC),
        // 导致每次进「数字分身」页都经隧道回源重拉 ~24s。文件按名版本化
        // (换模型 = 换文件名),immutable 长缓存安全;单用户场景浏览器缓存即根治。
        source: '/persona/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

export default nextConfig
