"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { stockLabel } from "@/lib/stock";
import { livePollSeconds } from "@/hooks/use-live";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
/** `url` null = belum ada yang perlu dimuat (mis. belum memilih barang). */
export function useData<T>(url: string | null, version = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const reload = useCallback(async () => {
    const id = ++request.current;
    if (url === null) {
      setData(undefined);
      setError("");
      setLoading(false);
      return;
    }
    try {
      const result = await api<T>(url);
      if (id === request.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (id === request.current) setError((e as Error).message);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    setLoading(true);
    void reload();
    return () => {
      request.current++;
    };
  }, [reload, version]);
  return { data, error, loading, reload };
}
export function Heading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="no-print mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 inline-flex items-center gap-2 text-[10px] font-semibold tracking-[.2em] text-emerald-700">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          WAREHOUSE OPERATIONS
        </p>
        <h1 className="text-2xl font-bold tracking-tight lg:text-[28px]">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-slate-500">
          {description}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
export function State({
  error,
  loading,
  empty,
}: {
  error?: string;
  loading?: boolean;
  empty?: boolean;
}) {
  if (error)
    return (
      <Card
        className="mb-5 flex items-start gap-3 border-red-200 bg-red-50/70 text-red-700"
        role="alert"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        {error}
      </Card>
    );
  if (loading)
    return (
      <Card aria-busy="true" aria-label="Memuat data">
        <div className="animate-pulse space-y-3">
          <div className="h-3 w-1/3 rounded-full bg-slate-200/80" />
          <div className="h-3 w-2/3 rounded-full bg-slate-100" />
          <div className="h-3 w-1/2 rounded-full bg-slate-100" />
        </div>
      </Card>
    );
  if (empty)
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-center text-slate-400">
        <span className="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-400">
          <Inbox className="size-5" />
        </span>
        Belum ada data yang sesuai.
      </Card>
    );
  return null;
}
// Label berbentuk pil dengan titik warna: hijau aman, kuning menipis, merah habis.
const pill =
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset before:size-1.5 before:rounded-full before:bg-current before:content-['']";
export function StockBadge({ stock }: { stock: number }) {
  const label = stockLabel(stock);
  return (
    <span
      className={`${pill} ${label === "STOK HABIS" ? "bg-red-50 text-red-700 ring-red-200" : label === "STOK MENIPIS" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}
    >
      {label}
    </span>
  );
}
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`${pill} ${value === "IN" || value === "APPROVED" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : value === "OUT" ? "bg-blue-50 text-blue-700 ring-blue-200" : value === "PENDING" ? "bg-amber-50 text-amber-700 ring-amber-200" : value === "ADJUSTMENT" ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-slate-100 text-slate-500 ring-slate-200"}`}
    >
      {value}
    </span>
  );
}
export function Pager({
  page,
  total,
  limit = 20,
  onPage,
}: {
  page: number;
  total: number;
  limit?: number;
  onPage: (n: number) => void;
}) {
  return (
    <div className="flex justify-between items-center mt-4 text-xs text-slate-500">
      <span>
        {total} data · Halaman {page} / {Math.max(1, Math.ceil(total / limit))}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Sebelumnya
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page * limit >= total}
          onClick={() => onPage(page + 1)}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  );
}
/** Tab antar-bagian dalam satu halaman: tautan (punya URL sendiri) atau tombol filter. */
export function Tabs({
  items,
}: {
  items: {
    key: string;
    label: string;
    active: boolean;
    href?: string;
    onClick?: () => void;
  }[];
}) {
  return (
    <div
      role="tablist"
      className="no-print mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-slate-200/50 p-1 ring-1 ring-inset ring-slate-200/70"
    >
      {items.map((t) => {
        const style = `rounded-lg px-3.5 py-2 text-sm font-medium transition ${t.active ? "bg-white text-emerald-800 shadow-[0_1px_3px_rgb(15_23_42/0.12)] ring-1 ring-slate-200/80" : "text-slate-600 hover:bg-white/60 hover:text-slate-900"}`;
        return t.href ? (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={t.active}
            className={style}
          >
            {t.label}
          </Link>
        ) : (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.active}
            onClick={t.onClick}
            className={style}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
export function Live({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${connected ? "bg-emerald-50 text-emerald-700 ring-emerald-200/80" : "bg-amber-50 text-amber-700 ring-amber-200/80"}`}
    >
      <span
        className={`size-2 rounded-full ring-4 ${connected ? "bg-emerald-500 ring-emerald-500/20" : "bg-amber-500 ring-amber-500/20"}`}
      />
      {livePollSeconds
        ? connected
          ? `Update otomatis tiap ${livePollSeconds} detik`
          : "Menyambung ulang…"
        : connected
          ? "Realtime aktif"
          : "Menyambung / polling 5s"}
    </span>
  );
}
export function Refresh({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Muat ulang"
      onClick={onClick}
    >
      <RefreshCw />
    </Button>
  );
}
