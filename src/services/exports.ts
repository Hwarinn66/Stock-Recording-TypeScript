import { stockLabel } from "@/lib/stock";
import { colors, newWorkbook, toBuffer, writeTable, type Column } from "@/lib/excel";
import { historyColumns, movementLabel } from "./excel-backup";
import type { InventoryProduct, OpnameRow, StockTransaction } from "@/types";

// Unduhan Excel dari web (data barang, riwayat, opname harian): hanya tabel (header di
// baris 1, tanpa judul/keterangan di luar tabel), gaya sama dengan Excel cadangan —
// header hijau, kolom selebar isinya, tanggal & jam zona aplikasi (WIB) sebagai nilai
// tanggal Excel, kode barang & no reservasi tetap teks.
const stockTone = {
  "STOK HABIS": "bad",
  "STOK MENIPIS": "warn",
  AMAN: "good",
} as const;

type Numbered<T> = T & { no: number };
const numbered = <T>(items: T[]) => items.map((item, i) => ({ ...item, no: i + 1 }));
const sheet = (wb: ReturnType<typeof newWorkbook>, name: string) =>
  wb.addWorksheet(name, { properties: { tabColor: { argb: colors.brand } } });

const productColumns: Column<Numbered<InventoryProduct>>[] = [
  { header: "No", width: 6, kind: "integer", value: (p) => p.no },
  { header: "Kode Barang", width: 16, kind: "code", value: (p) => p.sku },
  { header: "Nama Barang", width: 46, kind: "text", value: (p) => p.name },
  { header: "Kategori", width: 16, kind: "text", value: (p) => p.category_name },
  { header: "Ruangan", width: 18, kind: "text", value: (p) => p.room_name },
  { header: "Blok", width: 8, kind: "code", value: (p) => p.block_code },
  { header: "Lokasi", width: 16, kind: "code", value: (p) => p.location_code },
  { header: "Stok", width: 12, kind: "quantity", value: (p) => p.stock },
  { header: "Stok Minimal", width: 13, kind: "quantity", value: (p) => p.min_stock },
  { header: "Satuan", width: 9, kind: "text", value: (p) => p.unit },
  {
    header: "Status Stok",
    width: 15,
    kind: "text",
    value: (p) => stockLabel(p.stock, p.min_stock),
    tone: (p) => stockTone[stockLabel(p.stock, p.min_stock)],
  },
  {
    header: "Pergerakan",
    width: 17,
    kind: "text",
    value: (p) => movementLabel(p.movement_class),
  },
  {
    header: "Total Keluar (semua waktu)",
    width: 14,
    kind: "quantity",
    value: (p) => p.out_total,
  },
  {
    header: "Status Barang",
    width: 13,
    kind: "text",
    value: (p) => (p.active ? "Aktif" : "Nonaktif"),
    tone: (p) => (p.active ? undefined : "muted"),
  },
];

export async function productsWorkbook(items: InventoryProduct[]) {
  const wb = newWorkbook();
  writeTable(sheet(wb, "Data Barang"), {
    columns: productColumns,
    rows: numbered(items),
    freezeColumns: 3,
  });
  return toBuffer(wb);
}

export type HistoryKind = "all" | "in" | "out" | "adjustments" | "reservations";
const historySheets: Record<HistoryKind, string> = {
  all: "Riwayat",
  in: "Barang Masuk",
  out: "Barang Keluar",
  adjustments: "Koreksi Stok",
  reservations: "No Reservasi",
};
// Unduhan web memakai istilah Stok Awal / Stok Akhir. Excel cadangan & Excel live tetap
// "Stok Sebelum/Sesudah" agar query Excel live yang sudah terpasang tidak rusak.
const historyHeaders: Record<string, string> = {
  "Stok Sebelum": "Stok Awal",
  "Stok Sesudah": "Stok Akhir",
};

export async function historyWorkbook(kind: HistoryKind, items: StockTransaction[]) {
  // Tab No reservasi: no reservasi di kolom pertama. Kolom yang selalu kosong untuk
  // jenis transaksi itu tidak ikut (mis. kode masuk pada barang keluar).
  const reservation = historyColumns.find((c) => c.header === "No Reservasi")!;
  const skip: Record<HistoryKind, string[]> = {
    all: [],
    in: ["Jenis", "No Reservasi"],
    out: ["Jenis", "Kode Masuk"],
    adjustments: ["Jenis", "No Reservasi", "Kode Masuk"],
    reservations: ["Jenis", "Kode Masuk", "No Reservasi"],
  };
  const columns = [
    ...(kind === "reservations" ? [reservation] : []),
    ...historyColumns.filter((c) => !skip[kind].includes(c.header)),
  ].map((c) => (historyHeaders[c.header] ? { ...c, header: historyHeaders[c.header] } : c));
  const wb = newWorkbook();
  writeTable(sheet(wb, historySheets[kind]), {
    columns,
    rows: items,
    freezeColumns: 1,
  });
  return toBuffer(wb);
}

const opnameColumns: Column<Numbered<OpnameRow>>[] = [
  { header: "No", width: 6, kind: "integer", value: (r) => r.no },
  { header: "Kode Barang", width: 16, kind: "code", value: (r) => r.sku },
  { header: "Nama Barang", width: 44, kind: "text", value: (r) => r.name },
  { header: "Kategori", width: 14, kind: "text", value: (r) => r.category_name },
  { header: "Lokasi", width: 16, kind: "code", value: (r) => r.location_code },
  { header: "Satuan", width: 9, kind: "text", value: (r) => r.unit },
  { header: "Stok Awal", width: 11, kind: "quantity", value: (r) => r.opening },
  {
    header: "Masuk",
    width: 10,
    kind: "quantity",
    value: (r) => r.incoming || null,
    tone: (r) => (r.incoming ? "good" : undefined),
  },
  {
    header: "Keluar",
    width: 10,
    kind: "quantity",
    value: (r) => r.outgoing || null,
    tone: (r) => (r.outgoing ? "info" : undefined),
  },
  {
    header: "Koreksi",
    width: 10,
    kind: "signed",
    value: (r) => r.adjustment || null,
    tone: (r) => (r.adjustment ? "accent" : undefined),
  },
  { header: "Stok Akhir", width: 11, kind: "quantity", value: (r) => r.closing },
  {
    header: "Status Stok",
    width: 15,
    kind: "text",
    value: (r) => stockLabel(r.closing, r.min_stock),
    tone: (r) => stockTone[stockLabel(r.closing, r.min_stock)],
  },
  { header: "Transaksi", width: 10, kind: "integer", value: (r) => r.transactions || null },
];

/** Tanggal opname ada di nama sheet ("Opname 03-11-2026") dan nama file, bukan di sel. */
export async function opnameWorkbook(day: string, items: OpnameRow[]) {
  const wb = newWorkbook();
  writeTable(sheet(wb, `Opname ${day.split("-").reverse().join("-")}`), {
    columns: opnameColumns,
    rows: numbered(items),
    freezeColumns: 3,
  });
  return toBuffer(wb);
}
