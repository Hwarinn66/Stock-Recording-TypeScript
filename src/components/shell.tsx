"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Warehouse,
  LayoutDashboard,
  Package,
  Settings,
  LogOut,
  ClipboardList,
  Menu,
  Search,
} from "lucide-react";
import { write } from "@/lib/client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "sonner";
// [alamat, label, ikon, awalan alamat lain yang termasuk menu ini]. Fitur kecil
// digabung: Tambah Barang, stok menipis & koreksi stok (di detail barang) di
// Barang, riwayat & no reservasi di Riwayat, kategori di Pengaturan, transaksi
// pending di Dashboard. Lokasi barang dipilih lewat form Tambah/Edit Barang.
const links = [
  ["/", "Dashboard", LayoutDashboard, []],
  ["/products", "Barang", Package, ["/products/", "/low-stock"]],
  ["/history", "Riwayat", ClipboardList, ["/history/", "/reservations"]],
  ["/settings", "Pengaturan", Settings, []],
] as const;
function isActive(path: string, href: string, prefixes: readonly string[]) {
  return path === href || prefixes.some((p) => path === p || path.startsWith(p));
}
async function logout() {
  try {
    await write("auth/logout");
    location.href = "/login";
  } catch (e) {
    toast.error((e as Error).message);
  }
}
export function Shell({
  children,
  username,
}: {
  children: React.ReactNode;
  username: string;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const initial = username[0].toUpperCase();
  return (
    <div className="min-h-screen">
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/5 bg-linear-to-b from-slate-900 to-slate-950 text-slate-400 transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        <Link href="/" className="flex items-center gap-3 px-5 py-6">
          <span className="grid size-10 place-items-center rounded-xl bg-linear-to-br from-emerald-400 to-emerald-600 text-white shadow-[0_8px_20px_-8px_rgb(16_185_129/0.8)]">
            <Warehouse size={20} />
          </span>
          <span className="leading-tight">
            <span className="block font-bold tracking-wide text-white">
              WAREHOUSE
            </span>
            <span className="block text-[11px] text-slate-500">
              Stock Management
            </span>
          </span>
        </Link>
        <p className="px-6 pb-2 pt-3 text-[10px] font-semibold tracking-[.18em] text-slate-500">
          MENU
        </p>
        <nav className="space-y-1 overflow-auto px-3">
          {links.map(([href, label, Icon, prefixes]) => {
            const active = isActive(path, href, prefixes);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] font-medium transition ${active ? "bg-emerald-500/15 text-white ring-1 ring-inset ring-emerald-400/25" : "hover:bg-white/5 hover:text-white"}`}
              >
                <span
                  className={`grid size-8 place-items-center rounded-lg transition ${active ? "bg-emerald-500 text-white shadow-[0_6px_14px_-6px_rgb(16_185_129/0.9)]" : "bg-white/5 text-slate-400 group-hover:text-white"}`}
                >
                  <Icon size={16} />
                </span>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto p-3">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5 ring-1 ring-inset ring-white/5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-300">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {username}
              </p>
              <p className="text-[11px] text-slate-500">Akun aktif</p>
            </div>
            <button
              aria-label="Logout"
              title="Logout"
              onClick={logout}
              className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {open && (
        <button
          aria-label="Tutup navigasi"
          onClick={() => setOpen(false)}
          className="no-print fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-[1px] lg:hidden"
        />
      )}
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200/70 bg-white/80 px-5 backdrop-blur-md lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Buka menu"
            onClick={() => setOpen(!open)}
          >
            <Menu />
          </Button>
          <form action="/products" className="relative w-full max-w-md">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              size={16}
            />
            <Input
              name="q"
              aria-label="Pencarian cepat barang"
              placeholder="Cari nama barang, Kode Barang, atau rak…"
              className="border-transparent bg-slate-100/80 pl-10 shadow-none focus:bg-white"
            />
          </form>
          <span className="ml-auto hidden items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 text-xs font-medium text-slate-600 shadow-[0_1px_2px_rgb(15_23_42/0.05)] sm:flex">
            <span className="grid size-7 place-items-center rounded-full bg-linear-to-br from-emerald-400 to-emerald-600 text-[11px] font-bold text-white">
              {initial}
            </span>
            {username}
          </span>
        </header>
        <main className="mx-auto max-w-[1600px] p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
