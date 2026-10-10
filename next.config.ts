import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for the Docker image.
  output: "standalone",
  experimental: {
    serverActions: {
      // Document uploads ride through a Server Action, and the default cap is
      // 1MB. Sits just above MAX_DOCUMENT_BYTES (25MB, enforced in
      // src/lib/validators/document.ts) to leave room for the multipart
      // envelope — the action re-checks the real file size itself.
      bodySizeLimit: "26mb",
    },
  },
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/well-known/oauth-authorization-server",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/well-known/oauth-protected-resource",
      },
      {
        // RFC 9728 path-suffixed form for the /mcp resource. Same document.
        source: "/.well-known/oauth-protected-resource/mcp",
        destination: "/api/well-known/oauth-protected-resource",
      },
    ];
  },
};

// Serwist (v9) integrates via webpack, which conflicts with Next 16's default
// Turbopack dev server. We only wrap the config for production builds (run with
// `next build --webpack`) and leave `next dev` on plain Turbopack.
const isDev = process.env.NODE_ENV === "development";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  reloadOnOnline: true,
});

export default isDev ? nextConfig : withSerwist(nextConfig);
