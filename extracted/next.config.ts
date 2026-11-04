import type { NextConfig } from "next";

/**
 * `DZ_MOBILE_EXPORT=1` switches to a fully static export, used by the Android
 * build (Capacitor). The web build is unchanged.
 *
 * A static export has no server, so the two HTTP-only features are dropped:
 * custom response headers and the route handlers (the API folder is moved out
 * of the tree by `scripts/build-mobile.mjs` for the duration of the build).
 */
const mobileExport = process.env.DZ_MOBILE_EXPORT === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.e2b.app"],
  images: { unoptimized: true },
  ...(mobileExport
    ? {
        output: "export" as const,
        trailingSlash: true,
        // The test suite imports the route handlers that the export cannot
        // contain, so the mobile build type-checks the app only.
        typescript: { tsconfigPath: "./tsconfig.mobile.json" },
      }
    : {}),
  // Keep the development badge away from the bottom Menu control.
  devIndicators: { position: "top-right" },
  ...(mobileExport
    ? {}
    : {
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
      }),
};

export default nextConfig;
