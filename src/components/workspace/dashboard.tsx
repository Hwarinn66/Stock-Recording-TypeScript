"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Package,
  Boxes,
  Clock3,
  TriangleAlert,
  ClipboardCheck,
  PackageX,
  ArrowRight,
  ScanLine,
} from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { write, timestamp } from "@/lib/client";
import { allowsDecimal, MAX_QUANTITY, roundStock, validAmount } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type { StockTransaction, InventoryProduct } from "@/types";
import { Heading, State, Badge, Live, useData, StockBadge } from "./shared";
function PendingCard({
  item,
  onChange,
  timezone,
}: {
  item: StockTransaction;
  onChange: () => void;
  timezone?: string;
}) {
  const [qty, setQty] = useState(item.quantity?.toString() || "");
  const [busy, setBusy] = useState(false);
  const decimal = allowsDecimal(item.unit);
  const n = Number(qty.replace(",", "."));
  const valid = qty !== "" && validAmount(n, item.unit) && n > 0 && n <= MAX_QUANTITY;
  const after = roundStock(item.stock + (item.transaction_type === "IN" ? n : -n));
  const act = async (cancel = false) => {
    if (
      cancel &&
      !confirm(`Batalkan ${item.transaction_number}? Stok tidak berubah.`)
    )
      return;
    setBusy(true);
    try {
      if (cancel) await write(`transactions/${item.id}/cancel`);
      else await write(`transactions/${item.id}/approve`, { quantity: n });
      toast.success(
        cancel
          ? "Transaksi dibatalkan"
          : `Barang berhasil ${item.transaction_type === "IN" ? "masuk +" : "keluar -"}${n} ${item.unit}`,
      );
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="border-l-4 border-l-amber-400">
      <div className="flex justify-between items-start gap-3">
        <div>
          <div className="flex gap-2 mb-3">
            <Badge value={item.transaction_type} />
            <Badge value="PENDING" />
          </div>
          <h3 className="text-base font-semibold">{item.name}</h3>
          <p className="text-[10px] text-slate-400 mt-3">KODE BARANG</p>
          <p className="font-mono text-xl font-bold">{item.sku}</p>
          <p className="text-xs text-slate-500 mt-1">
            {item.room_name || "Ruangan lama"} · Lokasi {item.location_code} ·{" "}
            {item.transaction_number}
          </p>
          <p className="text-[11px] text-slate-400 mt-2">
            Scan {timestamp(item.scanned_at, timezone)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-500">STOK SAAT INI</p>
          <p className="text-2xl font-bold mt-1">
            {item.stock}{" "}
            <span className="text-xs font-normal">{item.unit}</span>
          </p>
        </div>
      </div>
      <div className="grid sm:grid-cols-[1fr_1fr] gap-4 mt-5">
        <div>
          <label htmlFor={"qty-" + item.id}>
            Quantity {item.transaction_type === "IN" ? "masuk" : "keluar"}
          </label>
          <Input
            id={"qty-" + item.id}
            type="number"
            min={decimal ? "0.001" : "1"}
            max="2147483647"
            step={decimal ? "0.001" : "1"}
            inputMode={decimal ? "decimal" : "numeric"}
            placeholder={decimal ? "Mis. 2.5" : "Masukkan jumlah"}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div
          className={`rounded-lg p-3 text-xs ${valid && after < 0 ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-500"}`}
        >
          Preview stok{" "}
          <div className="text-base font-semibold text-slate-800 mt-1">
            {item.stock} → {valid ? after : "—"}{" "}
            <span className="text-xs font-normal">{item.unit}</span>
          </div>
          {valid && after < 0 && "STOK TIDAK MENCUKUPI"}
        </div>
      </div>
      <div className="flex gap-2 mt-4 justify-end">
        <Button variant="outline" disabled={busy} onClick={() => act(true)}>
          Batalkan
        </Button>
        <Button disabled={busy || !valid || after < 0} onClick={() => act()}>
          {busy ? "Memproses…" : "Approve"}
          <ClipboardCheck />
        </Button>
      </div>
    </Card>
  );
}
export function PendingList({
  version,
  onChange,
}: {
  version: number;
  onChange?: () => void;
}) {
  const list = useData<StockTransaction[]>("pending-transactions", version);
  const settings = useData<{ timezone?: string }>("settings");
  return (
    <>
      <State
        error={list.error}
        loading={!list.data && list.loading}
        empty={list.data?.length === 0}
      />
      <div className="grid xl:grid-cols-2 gap-4">
        {list.data?.map((item) => (
          <PendingCard
            key={item.id}
            item={item}
            timezone={settings.data?.timezone}
            onChange={() => {
              void list.reload();
              onChange?.();
            }}
          />
        ))}
      </div>
    </>
  );
}
// Barang keluar terbaru dari aplikasi HP beserta no reservasi (identitas pengambilan & divisi).
function RecentReservations({ version }: { version: number }) {
  const list = useData<{ items: StockTransaction[] }>(
    "history/reservations?limit=8&sort=scanned_at&direction=desc",
    version,
  );
  const settings = useData<{ timezone?: string }>("settings");
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">No reservasi terbaru</h2>
        <Link href="/reservations" className="text-xs text-emerald-700">
          Lihat semua →
        </Link>
      </div>
      <State
        error={list.error}
        loading={!list.data && list.loading}
        empty={list.data?.items.length === 0}
      />
      {!!list.data?.items.length && (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {[
                  "No Reservasi",
                  "Waktu",
                  "Kode Barang",
                  "Nama Barang",
                  "Qty Keluar",
                  "Lokasi",
                  "Petugas",
                  "Nomor Transaksi",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((t) => (
                <tr key={t.id}>
                  <td className="font-mono text-sm font-bold">
                    {t.reservation_number}
                  </td>
                  <td>{timestamp(t.scanned_at, settings.data?.timezone)}</td>
                  <td className="font-mono">{t.sku}</td>
                  <td>{t.name}</td>
                  <td className="font-bold">
                    {t.quantity} {t.unit}
                  </td>
                  <td>
                    {t.room_name} / {t.location_code}
                  </td>
                  <td>{t.actor_name || "—"}</td>
                  <td className="text-slate-500">{t.transaction_number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
export function PendingPage() {
  const { version, connected } = useLive();
  return (
    <>
      <Heading
        title="Transaksi menunggu"
        description="Periksa quantity dan setujui pergerakan stok dari scanner."
      >
        <Live connected={connected} />
      </Heading>
      <PendingList version={version} />
    </>
  );
}
export function Dashboard() {
  const { version, connected } = useLive();
  const stats = useData<Record<string, number>>("dashboard", version);
  const low = useData<{ items: InventoryProduct[] }>(
    "products?stock=low&limit=5&sort=stock&direction=asc",
    version,
  );
  const cards = [
    ["Total Barang", "total_products", Package],
    ["Total Stock", "total_stock", Boxes],
    ["Barang Masuk Hari Ini", "incoming", ArrowDownToLine],
    ["Barang Keluar Hari Ini", "outgoing", ArrowUpFromLine],
    ["Stock Menipis (1–2)", "low_stock", TriangleAlert],
    ["Stock Habis", "zero_stock", PackageX],
    ["Transaksi Pending", "pending", Clock3],
    ["Transaksi Hari Ini", "today", ClipboardCheck],
  ] as const;
  return (
    <>
      <Heading
        title="Dashboard gudang"
        description="Pantau persediaan dan pergerakan barang dalam satu tempat."
      >
        <Live connected={connected} />
        <Button asChild>
          <Link href="/products/new">+ Tambah Barang</Link>
        </Button>
      </Heading>
      <State error={stats.error} loading={!stats.data && stats.loading} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {cards.map(([label, key, Icon], i) => (
          <Card key={key}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">{label}</p>
              <Icon
                size={17}
                className={
                  i === 4 || i === 5 ? "text-red-400" : "text-emerald-600"
                }
              />
            </div>
            <p className="text-3xl font-bold mt-4 tabular-nums">
              {stats.data?.[key] ?? "—"}
            </p>
            <p className="mt-2 text-[10px] text-slate-400">
              {i < 2
                ? "Barang aktif"
                : i === 4 || i === 5
                  ? "Perlu perhatian"
                  : "Data tersimpan di MySQL"}
            </p>
          </Card>
        ))}
      </div>
      <RecentReservations version={version} />
      <div className="grid xl:grid-cols-[1fr_320px] gap-6">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">
              Transaksi menunggu{" "}
              <span className="text-xs bg-amber-100 text-amber-700 rounded px-2 py-1 ml-2">
                {stats.data?.pending ?? 0}
              </span>
            </h2>
            <Link href="/pending" className="text-xs text-emerald-700">
              Lihat semua →
            </Link>
          </div>
          <PendingList version={version} onChange={() => void stats.reload()} />
        </section>
        <section>
          <h2 className="text-lg font-bold mb-4">Perhatian stok</h2>
          <Card className="p-0 overflow-hidden">
            <State
              error={low.error}
              loading={!low.data && low.loading}
              empty={low.data?.items.length === 0}
            />
            {low.data?.items.map((p) => (
              <Link
                key={p.id}
                href={"/products/" + p.id}
                className="block p-4 border-b border-slate-100"
              >
                <div className="flex justify-between gap-2">
                  <span className="text-xs font-semibold">{p.name}</span>
                  <span className="text-red-700 font-bold">{p.stock}</span>
                </div>
                <div className="flex justify-between mt-2 text-[10px] text-slate-400">
                  <span>
                    {p.sku} · {p.location_code}
                  </span>
                  <StockBadge stock={p.stock} />
                </div>
              </Link>
            ))}
            <Link
              href="/low-stock"
              className="flex items-center justify-between p-4 text-xs text-emerald-700"
            >
              Lihat stok menipis
              <ArrowRight size={14} />
            </Link>
          </Card>
          <Card className="mt-5 bg-emerald-900 text-white border-0">
            <ScanLine className="mb-4 text-emerald-300" />
            <h3 className="font-bold">Dari rak ke dashboard.</h3>
            <p className="text-xs leading-5 text-emerald-100/70 mt-2">
              Buka aplikasi Warehouse Scanner di HP, pilih IN atau OUT, scan
              QR barang, lalu isi jumlah. Barang keluar wajib no reservasi.
              Stok langsung diperbarui.
            </p>
          </Card>
        </section>
      </div>
    </>
  );
}
