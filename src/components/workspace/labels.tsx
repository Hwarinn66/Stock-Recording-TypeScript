"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { LabelCandidate, LocationLookup, Lookup } from "@/types";
import { Heading, State, useData } from "./shared";

const movements = [
  ["FAST", "Fast moving"],
  ["SLOW", "Slow moving"],
  ["DEAD", "Dead stock"],
  ["NONE", "Belum diberi label"],
] as const;
const movementName = (m: LabelCandidate["movement_class"]) =>
  movements.find(([key]) => key === (m ?? "NONE"))![1];

// Print QR banyak barang sekaligus: saring dengan filter, centang barang, lalu cetak
// PDF label 35 x 35 mm (kertas A4 35 label per halaman, atau printer label).
export function LabelsPage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [block, setBlock] = useState("");
  const [rack, setRack] = useState("");
  const [movement, setMovement] = useState("");
  const [withLocation, setWithLocation] = useState(true);
  const params = new URLSearchParams({
    q,
    ...(category ? { category_id: category } : {}),
    ...(block ? { block_id: block } : {}),
    ...(rack ? { rack_id: rack } : {}),
    ...(movement ? { movement } : {}),
  });
  const list = useData<{ items: LabelCandidate[]; total: number; limit: number }>(
    "labels?" + params,
  );
  const categories = useData<Lookup[]>("categories");
  const blocks = useData<LocationLookup[]>("blocks");
  const racks = useData<LocationLookup[]>("racks");
  // Filter berubah → semua barang hasil filter tercentang; hapus centang yang tidak dicetak.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    setSelected(new Set(list.data?.items.map((i) => i.id)));
  }, [list.data]);
  const items = list.data?.items ?? [];
  const chosen = items.filter((i) => selected.has(i.id));
  const allChecked = items.length > 0 && chosen.length === items.length;
  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const print = (layout: "sheet" | "roll") =>
    window.open(
      "/api/labels/pdf?" +
        new URLSearchParams({
          ids: chosen.map((i) => i.id).join(","),
          layout,
          location: withLocation ? "1" : "0",
        }),
      "_blank",
    );
  return (
    <>
      <Heading
        title="Print QR massal"
        description="Saring barang dengan filter, centang barang yang mau dicetak, lalu print. Label 35 × 35 mm berisi QR dan kode barang, urut lokasi rak."
      >
        <Button variant="outline" asChild>
          <Link href="/products">
            <ArrowLeft />
            Data barang
          </Link>
        </Button>
      </Heading>
      <Card className="mb-5">
        <div className="flex flex-wrap gap-3">
          <Input
            aria-label="Cari barang"
            placeholder="Cari nama, kode barang, lokasi…"
            className="max-w-xs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label="Blok"
            value={block}
            onChange={(e) => {
              setBlock(e.target.value);
              setRack("");
            }}
          >
            <option value="">Semua blok</option>
            {blocks.data?.map((b) => (
              <option key={b.id} value={b.id}>
                Blok {b.code}
              </option>
            ))}
          </select>
          <select aria-label="Rak" value={rack} onChange={(e) => setRack(e.target.value)}>
            <option value="">Semua rak</option>
            {racks.data
              ?.filter((r) => !block || r.block_id === Number(block))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  Rak {r.code}
                </option>
              ))}
          </select>
          <select
            aria-label="Pergerakan"
            value={movement}
            onChange={(e) => setMovement(e.target.value)}
          >
            <option value="">Semua pergerakan</option>
            {movements.map(([key, label]) => (
              <option key={key} value={key}>
                {label} saja
              </option>
            ))}
          </select>
          <select
            aria-label="Kategori"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Semua kategori</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="border-t border-slate-100 mt-4 pt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-600 mr-auto">
            <b className="text-slate-900">{chosen.length}</b> dari {list.data?.total ?? 0} barang
            dipilih
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={withLocation}
              onChange={(e) => setWithLocation(e.target.checked)}
            />
            Tulis lokasi di bawah kode (mis. Blok A - A.01.01)
          </label>
          <Button disabled={!chosen.length} onClick={() => print("sheet")}>
            <Printer />
            Print A4 · 35 label per halaman
          </Button>
          <Button variant="outline" disabled={!chosen.length} onClick={() => print("roll")}>
            <Printer />
            Printer label 35 × 35 mm
          </Button>
        </div>
        {list.data && list.data.total > list.data.limit && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {list.data.total} barang cocok; sekali print maksimal {list.data.limit} label (
            {list.data.limit} barang pertama menurut lokasi). Persempit dengan blok, rak, atau
            pergerakan untuk mencetak sisanya.
          </p>
        )}
      </Card>
      <State
        error={list.error}
        loading={!list.data && list.loading}
        empty={list.data?.items.length === 0}
      />
      {!!items.length && (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Pilih semua"
                    checked={allChecked}
                    onChange={() =>
                      setSelected(new Set(allChecked ? [] : items.map((i) => i.id)))
                    }
                  />
                </th>
                {["Kode Barang", "Nama Barang", "Kategori", "Lokasi", "Pergerakan"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.id}
                  className={selected.has(p.id) ? "" : "opacity-50"}
                  onClick={() => toggle(p.id)}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={"Pilih " + p.sku}
                      checked={selected.has(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(p.id)}
                    />
                  </td>
                  <td className="font-mono font-bold text-slate-900">{p.sku}</td>
                  <td className="font-semibold">
                    <div className="w-80 whitespace-normal [overflow-wrap:anywhere]">{p.name}</div>
                  </td>
                  <td className="text-xs">{p.category_name}</td>
                  <td>
                    <span className="bg-slate-100 rounded px-2 py-1 text-xs">
                      {p.location_code}
                    </span>
                  </td>
                  <td className="text-xs">{movementName(p.movement_class)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
