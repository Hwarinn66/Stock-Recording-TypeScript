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
export function Shell({
  children,
  username,
}: {
  children: React.ReactNode;
  username: string;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 w-60 bg-slate-900 text-slate-400 flex flex-col transition-transform ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        <Link
          href="/"
          className="flex items-center gap-3 px-6 py-7 text-white font-bold text-lg"
        >
          <Warehouse className="text-emerald-400" /> WAREHOUSE
          <span className="text-emerald-400">/</span>
        </Link>
        <p className="px-6 pt-4 pb-3 text-[10px] tracking-[.18em] text-slate-500">
          WORKSPACE
        </p>
        <nav className="px-3 space-y-1 overflow-auto">
          {links.map(([href, label, Icon, prefixes]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`flex gap-3 items-center px-3 py-2.5 rounded-lg text-[13px] ${isActive(path, href, prefixes) ? "bg-emerald-800/70 text-white" : "hover:bg-slate-800 hover:text-white"}`}
            >
              <Icon size={17} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto p-4">
          <button
            className="flex items-center gap-3 p-3 text-xs"
            onClick={async () => {
              try {
                await write("auth/logout");
                location.href = "/login";
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            <LogOut size={16} />
            Logout · {username}
          </button>
        </div>
      </aside>
      {open && (
        <button
          aria-label="Tutup navigasi"
          onClick={() => setOpen(false)}
          className="no-print lg:hidden fixed inset-0 bg-black/30 z-30"
        />
      )}
      <div className="lg:pl-60">
        <header className="no-print h-20 bg-white border-b border-slate-200 px-5 lg:px-9 flex items-center justify-between gap-5">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Buka menu"
            onClick={() => setOpen(!open)}
          >
            <Menu />
          </Button>
          <form action="/products" className="relative max-w-md w-full">
            <Search
              className="absolute left-3 top-3 text-slate-400"
              size={16}
            />
            <Input
              name="q"
              placeholder="Cari nama barang, Kode Barang, atau rak…"
              className="pl-10 bg-slate-50 border-0"
            />
          </form>
          <span className="hidden sm:flex items-center gap-3 text-xs">
            <span className="w-8 h-8 bg-emerald-100 text-emerald-800 rounded-full grid place-items-center font-bold">
              {username[0].toUpperCase()}
            </span>
            {username}
          </span>
        </header>
        <main className="p-5 lg:p-9 max-w-[1600px] mx-auto">{children}</main>
      </div>
    </div>
  );
}
