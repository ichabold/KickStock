/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@kickstock/types',
    '@kickstock/constants',
    '@kickstock/game-engine',
  ],
  eslint: {
    ignoreDuringBuilds: true,   // ESLint not installed as build dep — lint locally
  },
  typescript: {
    ignoreBuildErrors: false,   // keep TS errors fatal
  },
};

module.exports = nextConfig;
