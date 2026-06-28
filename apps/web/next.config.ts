/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@audiocomic/domain',
    '@audiocomic/shared',
    '@audiocomic/db',
    '@audiocomic/ai',
    '@audiocomic/renderers',
    '@audiocomic/media',
    '@audiocomic/workflows',
    '@audiocomic/actors',
    '@rivetkit/effect',
    'rivetkit',
  ],
  experimental: {
    serverActions: { bodySizeLimit: '100mb' },
  },
  turbopack: {
    resolveExtensions: [
      '.ts', '.tsx', '.js', '.jsx', '.json',
      '.js.ts', '.js.tsx',
    ],
  },
};

export default nextConfig;
