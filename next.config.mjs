// Dev only: `LOOM_DEV_API=http://localhost:8787 next dev` proxies the Worker
// routes (`/api/*`, `/s/*`) to a local `wrangler dev` so live feeds, catalog
// search, and share links work without deploying. Static export ignores this.
const devApi = process.env.NODE_ENV === "development" ? process.env.LOOM_DEV_API : undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  ...(devApi
    ? {
        async rewrites() {
          return [
            { source: "/api/:path*", destination: `${devApi}/api/:path*` },
            { source: "/s/:path*", destination: `${devApi}/s/:path*` },
          ];
        },
      }
    : {}),
  images: {
    unoptimized: true,
  },
  // Keep default distDir (`.next`) so `next dev` / Turbopack do not write SSR
  // chunks into `out/` and then fail looking for app-build-manifest.json.
  // Static export still lands in `out/` for Tauri `frontendDist` + loft.
  turbopack: {
    rules: {
      "*.wgsl": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.wgsl$/,
      type: "asset/source",
    });
    return config;
  },
};

export default nextConfig;
