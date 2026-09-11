import type { NextConfig } from 'next';

const nextConfig: NextConfig = process.env.PUZZLE_TARGET === 'node' ? { output: 'standalone' } : {};

export default nextConfig;
