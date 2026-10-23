"use client";
import { useState } from "react";
import { Warehouse, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { write } from "@/lib/client";
export default function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      <section className="hidden lg:flex bg-slate-900 text-white p-16 flex-col justify-between">
        <div className="flex items-center gap-3 text-xl font-bold">
          <Warehouse /> WAREHOUSE<span className="text-emerald-400">/</span>
        </div>
        <div>
          <p className="text-emerald-400 text-xs tracking-[.25em] mb-6">
            SETIAP BARANG. SETIAP PERGERAKAN.
          </p>
          <h1 className="text-5xl font-semibold leading-tight max-w-lg">
            Stok terkontrol.
            <br />
            Operasional lebih pasti.
          </h1>
          <p className="mt-6 text-slate-400 max-w-md leading-7">
            Scan QR dari rak, periksa transaksi, lalu setujui perubahan stok.
            Semua pergerakan tercatat dalam satu tempat.
          </p>
        </div>
        <p className="text-slate-500 text-xs">
          WAREHOUSE STOCK MANAGEMENT · QR SYSTEM
        </p>
      </section>
      <section className="flex items-center justify-center p-8">
        <form
          className="w-full max-w-sm"
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
          <div className="bg-emerald-100 text-emerald-700 w-12 h-12 rounded-xl flex items-center justify-center mb-7">
            <Warehouse />
          </div>
          <h1 className="text-3xl font-bold mb-2">Selamat datang</h1>
          <p className="text-slate-500 mb-8">
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
              className="text-red-700 bg-red-50 p-3 rounded-lg mb-4"
            >
              {error}
            </p>
          )}
          <Button className="w-full" disabled={busy}>
            {busy ? "Memproses…" : "LOGIN"}
            <ArrowRight />
          </Button>
          <p className="mt-6 text-xs text-slate-400">
            Akun dibuat melalui perintah setup di komputer. Lihat README.
          </p>
        </form>
      </section>
    </main>
  );
}
