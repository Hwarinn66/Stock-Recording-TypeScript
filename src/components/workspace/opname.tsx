"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Lookup, OpnameResult, UsedLocations } from "@/types";
import { Heading, Pager, State, StockBadge, useData } from "./shared";

const LIMIT = 50;
const qty = (n: number) =>
  n.toLocaleString("id-ID", { maximumFractionDigits: 3 });
/** Angka hari itu; 0 = tanda pisah agar barang yang bergerak mudah terlihat. */
const moved = (n: number, sign = "") =>
  n ? `${sign && n > 0 ? sign : ""}${qty(n)}` : "—";

/** Tanggal hari ini (yyyy-mm-dd) di zona waktu aplikasi. */
function useToday() {
  const settings = useData<{ timezone?: string }>("settings");
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: settings.data?.timezone || "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
  }, [settings.data?.timezone]);
  return today;
}

export function OpnamePage() {
  const { version } = useLive();
  const today = useToday();
  const [date, setDate] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [block, setBlock] = useState("");
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState("location");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({
    q,
    sort,
    all: all ? "1" : "0",
    page: String(page),
    limit: String(LIMIT),
    ...(date ? { date } : {}),
    ...(category ? { category_id: category } : {}),
    ...(block ? { block_id: block } : {}),
  });
  const list = useData<OpnameResult>("opname?" + params, version);
  const categories = useData<Lookup[]>("categories");
  // Hanya blok yang berisi barang (blok kosong bawaan tiap ruangan tidak ditampilkan).
  const places = useData<UsedLocations>("used-locations");
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const shown = date || list.data?.date || today;
  const isToday = !date || date === today;
  return (
    <>
      <Heading
        title="Opname harian"
        description="Per barang pada tanggal yang dipilih (jam WIB): stok awal, masuk, keluar, koreksi, dan stok akhir. Stok akhir hari ini = stok sekarang. Cocokkan kolom Stok akhir dengan hitungan fisik di rak."
      >
        <Button variant="outline" asChild>
          <a href={"/api/opname?" + params + "&export=xlsx"}>
            <Download />
            Export Excel
          </a>
        </Button>
      </Heading>
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            aria-label="Tanggal opname"
            type="date"
            className="w-auto"
            max={today || undefined}
            value={shown}
            onChange={(e) => reset(() => setDate(e.target.value))}
          />
          {!isToday && (
            <Button variant="outline" size="sm" onClick={() => reset(() => setDate(""))}>
              Hari ini
            </Button>
          )}
          <Input
            aria-label="Cari barang"
            placeholder="Cari nama, kode barang, lokasi…"
            className="max-w-xs"
            value={q}
            onChange={(e) => reset(() => setQ(e.target.value))}
          />
          <select
            aria-label="Kategori"
            value={category}
            onChange={(e) => reset(() => setCategory(e.target.value))}
          >
            <option value="">Semua kategori</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Blok"
            value={block}
            onChange={(e) => reset(() => setBlock(e.target.value))}
          >
            <option value="">Semua blok</option>
            {places.data?.blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Urutkan"
            value={sort}
            onChange={(e) => reset(() => setSort(e.target.value))}
          >
            <option value="location">Urut lokasi (rak)</option>
            <option value="name">Nama A–Z</option>
            <option value="outgoing">Keluar terbanyak</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => reset(() => setAll(e.target.checked))}
            />
            Tampilkan semua barang aktif
          </label>
        </div>
        {list.data && (
          <p className="border-t border-slate-100 mt-4 pt-4 text-sm text-slate-600">
            <b>{list.data.moved}</b> barang bergerak · <b>{list.data.outgoing_items}</b>{" "}
            barang keluar · <b>{list.data.incoming_items}</b> barang masuk
            {all && <> · {list.data.total} barang ditampilkan</>}
          </p>
        )}
      </Card>
      <State
        error={list.error}
        loading={!list.data && list.loading}
        empty={list.data?.items.length === 0}
      />
      {!!list.data?.items.length && (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {["Kode Barang", "Nama Barang", "Lokasi", "Stok awal", "Masuk", "Keluar", "Koreksi", "Stok akhir", "Satuan", "Status"].map(
                  (h) => (
                    <th key={h}>{h}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono font-bold text-slate-900">{r.sku}</td>
                  <td className="font-semibold">
                    {/* Nama panjang (ERP) dibungkus agar angka tetap terlihat. */}
                    <div className="w-72 whitespace-normal [overflow-wrap:anywhere]">
                      <Link href={"/products/" + r.id}>{r.name}</Link>
                      {!r.active && (
                        <span className="ml-2 text-[10px] text-slate-400">NONAKTIF</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="bg-slate-100 rounded px-2 py-1 text-xs">
                      {r.location_code}
                    </span>
                  </td>
                  <td className="tabular-nums">{qty(r.opening)}</td>
                  <td className="tabular-nums font-semibold text-emerald-700">
                    {moved(r.incoming)}
                  </td>
                  <td className="tabular-nums font-semibold text-blue-700">
                    {moved(r.outgoing)}
                  </td>
                  <td className="tabular-nums text-violet-700">
                    {moved(r.adjustment, "+")}
                  </td>
                  <td className="tabular-nums text-base font-bold text-slate-900">
                    {qty(r.closing)}
                  </td>
                  <td className="text-xs">{r.unit}</td>
                  <td>
                    <StockBadge stock={r.closing} min={r.min_stock} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {list.data && (
        <Pager page={page} total={list.data.total} limit={LIMIT} onPage={setPage} />
      )}
    </>
  );
}
