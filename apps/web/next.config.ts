/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@audiocomic/domain',
    '@audiocomic/shared',
    '@audiocomic/db',
    '@audiocomic/workflows',
  ],
  experimental: {
    serverActions: { bodySizeLimit: '100mb' },
  },
};

export default nextConfig;
