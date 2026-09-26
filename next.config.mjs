/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
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
