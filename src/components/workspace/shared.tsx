"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { stockLabel } from "@/lib/stock";
import { livePollSeconds } from "@/hooks/use-live";
import { RefreshCw } from "lucide-react";
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
    <div className="no-print flex flex-wrap items-center justify-between gap-4 mb-7">
      <div>
        <p className="text-[10px] font-semibold tracking-[.2em] text-emerald-700 mb-2">
          WAREHOUSE OPERATIONS
        </p>
        <h1 className="text-2xl lg:text-3xl font-bold">{title}</h1>
        <p className="text-slate-500 text-sm mt-2">{description}</p>
      </div>
      <div className="flex gap-2">{children}</div>
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
      <Card className="text-red-700 mb-5" role="alert">
        {error}
      </Card>
    );
  if (loading)
    return (
      <Card className="text-slate-400 animate-pulse">
        Memuat data dari database…
      </Card>
    );
  if (empty)
    return (
      <Card className="text-center text-slate-400 py-12">
        Belum ada data yang sesuai.
      </Card>
    );
  return null;
}
export function StockBadge({ stock }: { stock: number }) {
  return (
    <span
      className={`text-[10px] font-bold px-2 py-1 rounded ${stock <= 2 ? "text-red-700 bg-red-50" : "text-emerald-700 bg-emerald-50"}`}
    >
      {stockLabel(stock)}
    </span>
  );
}
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`text-[10px] font-bold px-2 py-1 rounded ${value === "IN" || value === "APPROVED" ? "bg-emerald-50 text-emerald-700" : value === "OUT" ? "bg-blue-50 text-blue-700" : value === "PENDING" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}
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
export function Live({ connected }: { connected: boolean }) {
  return (
    <span
      className={`flex items-center gap-2 text-xs ${connected ? "text-emerald-700" : "text-amber-700"}`}
    >
      <span
        className={`size-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`}
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
