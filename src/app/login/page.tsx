"use client";
import { useState } from "react";
import {
  Warehouse,
  ArrowRight,
  ScanLine,
  ClipboardList,
  ShieldCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { write } from "@/lib/client";
const points = [
  [ScanLine, "Scan QR dari HP, stok langsung diperbarui"],
  [ClipboardList, "Riwayat masuk, keluar, dan no reservasi tercatat"],
  [ShieldCheck, "Koreksi dan revisi selalu meninggalkan jejak"],
] as const;
export default function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-linear-to-br from-slate-900 via-slate-950 to-emerald-950 p-14 text-white lg:flex">
        {/* Dekorasi CSS saja (tanpa gambar) agar halaman tetap ringan. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -right-24 size-96 rounded-full bg-emerald-500/20 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-linear-to-br from-emerald-400 to-emerald-600 shadow-[0_8px_20px_-8px_rgb(16_185_129/0.8)]">
            <Warehouse size={20} />
          </span>
          <span className="leading-tight">
            <span className="block font-bold tracking-wide">WAREHOUSE</span>
            <span className="block text-[11px] text-slate-400">
              Stock Management
            </span>
          </span>
        </div>
        <div className="relative">
          <p className="mb-6 text-xs tracking-[.25em] text-emerald-400">
            SETIAP BARANG. SETIAP PERGERAKAN.
          </p>
          <h1 className="max-w-lg text-5xl font-semibold leading-tight">
            Stok terkontrol.
            <br />
            Operasional lebih pasti.
          </h1>
          <ul className="mt-9 space-y-3">
            {points.map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-3 text-slate-300">
                <span className="grid size-8 place-items-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/10">
                  <Icon size={16} className="text-emerald-300" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">
          WAREHOUSE STOCK MANAGEMENT · QR SYSTEM
        </p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-10">
        <form
          className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-7 shadow-lift"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              await write("auth/login", Object.fromEntries(f));
              location.href = "/";
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="mb-6 grid size-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100">
            <Warehouse />
          </span>
          <h1 className="mb-1.5 text-2xl font-bold">Selamat datang</h1>
          <p className="mb-7 text-slate-500">
            Masuk untuk mengelola gudang Anda.
          </p>
          <label htmlFor="username">Username atau email</label>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            required
            className="mb-5"
          />
          <label htmlFor="password">Password</label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mb-5"
          />
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-xl bg-red-50 p-3 text-red-700 ring-1 ring-inset ring-red-200"
            >
              {error}
            </p>
          )}
          <Button className="h-11 w-full" disabled={busy}>
            {busy ? "Memproses…" : "LOGIN"}
            <ArrowRight />
          </Button>
        </form>
      </section>
    </main>
  );
}
