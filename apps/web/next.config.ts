import type { NextConfig } from "next";

/**
 * Browser calls same-origin `/api/...` (NEXT_PUBLIC_API_URL empty).
 * Next.js rewrites proxy to the FastAPI origin so httpOnly cookies stay on the Vercel host.
 *
 * Local:  PEJU_API_ORIGIN unset → http://localhost:8000
 * Prod:   PEJU_API_ORIGIN=https://your-api.onrender.com
 */
const apiOrigin = (
  process.env.PEJU_API_ORIGIN ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${apiOrigin}/uploads/:path*`,
      },
      {
        source: "/health",
        destination: `${apiOrigin}/health`,
      },
      {
        source: "/ready",
        destination: `${apiOrigin}/ready`,
      },
    ];
  },
};

export default nextConfig;
