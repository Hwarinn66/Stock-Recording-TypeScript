import type { NextConfig } from "next";

function devOrigins() {
  // Diambil dari .env.local saja; IP LAN berubah-ubah sehingga tidak ditulis di kode.
  const configured = [
    process.env.APP_URL || "",
    ...(process.env.ALLOWED_ORIGINS || "").split(","),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).hostname;
      } catch {
        return value;
      }
    });

  return Array.from(new Set(configured));
}

// Vercel menghitung jam server selama koneksi terbuka, sehingga SSE yang selalu
// tersambung cepat menghabiskan kuota gratis. Build di Vercel (VERCEL=1) memakai
// cek berkala; 0 = SSE realtime untuk server sendiri (PC/VPS).
const livePollSeconds =
  process.env.LIVE_POLL_SECONDS || (process.env.VERCEL ? "15" : "0");

const config: NextConfig = {
  poweredByHeader: false,
  env: { LIVE_POLL_SECONDS: livePollSeconds },
  serverExternalPackages: ["mysql2", "bcryptjs"],
  allowedDevOrigins: devOrigins(),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          // Scan kamera kini lewat aplikasi Flutter; halaman web tidak butuh kamera.
          { key: "Permissions-Policy", value: "camera=(), microphone=()" },
        ],
      },
    ];
  },
};
export default config;
