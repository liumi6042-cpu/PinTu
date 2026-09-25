import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
 ...(process.env.PUZZLE_TARGET === 'node' ? { output: 'standalone' as const } : {}),
 async headers(){return [{source:'/cosmetics/assets/:path*',headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]}];},
};

export default nextConfig;
