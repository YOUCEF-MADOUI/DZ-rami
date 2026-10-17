import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.e2b.app"],
  images: { unoptimized: true },
  // Keep the development badge away from the bottom Menu control.
  devIndicators: { position: 'top-right' },
  // Prevent the preview/browser from serving a stale cached page.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
