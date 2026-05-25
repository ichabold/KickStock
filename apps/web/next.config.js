/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@kickstock/types',
    '@kickstock/constants',
    '@kickstock/game-engine',
  ],
};

module.exports = nextConfig;
