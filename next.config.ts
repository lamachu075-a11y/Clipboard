import type { NextConfig } from 'next';

// Static export: the app runs entirely in the browser, so `next build` writes
// plain HTML/JS/CSS to ./out that any static host (e.g. GitHub Pages) can serve.
// Set BASE_PATH when it is served from a sub-path, e.g. BASE_PATH=/Clipboard.
const basePath: string = process.env.BASE_PATH || '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
