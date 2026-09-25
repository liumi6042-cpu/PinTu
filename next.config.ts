import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
 ...(process.env.PUZZLE_TARGET === 'node' ? { output: 'standalone' as const } : {}),
 // The static server already supplies public, max-age=3600. Append only the
 // immutable directive; duplicate max-age values invalidate shared caching.
 async headers(){return [{source:'/cosmetics/assets/:path*',headers:[{key:'Cache-Control',value:'immutable'}]}];},
};

export default nextConfig;
