import type { NextConfig } from 'next';

const internalApiOrigin = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:8000';

if (!/^https?:\/\//.test(internalApiOrigin)) {
  throw new Error('API_INTERNAL_URL must be an HTTP(S) origin');
}

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${internalApiOrigin}/api/v1/:path*` },
      { source: '/api/schema/:path*', destination: `${internalApiOrigin}/api/schema/:path*` },
      { source: '/api/docs/:path*', destination: `${internalApiOrigin}/api/docs/:path*` },
    ];
  },
};

export default nextConfig;
