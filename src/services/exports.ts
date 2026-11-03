import { rows } from "@/lib/db";
import { stockLabel } from "@/lib/stock";
import {
  colors,
  describeTime,
  newWorkbook,
  toBuffer,
  writeTable,
  type Column,
} from "@/lib/excel";
import { historyColumns, movementLabel } from "./excel-backup";
import type { InventoryProduct, OpnameRow, StockTransaction } from "@/types";

// Unduhan Excel dari web (data barang, riwayat, opname harian): gaya sama dengan Excel
// cadangan — judul & keterangan filter, header hijau, kolom selebar isinya, tanggal & jam
// zona aplikasi (WIB) sebagai nilai tanggal Excel, kode barang & no reservasi tetap teks.
const stockTone = {
  "STOK HABIS": "bad",
  "STOK MENIPIS": "warn",
  AMAN: "good",
} as const;

/** Filter yang dipakai saat mengunduh, dalam kata-kata (baris keterangan file). */
export async function describeFilters(f: {
  q?: string;
  category_id?: number;
  block_id?: number;
  room_id?: number;
  rack_id?: number;
  location_id?: number;
  product_id?: number;
  stock?: "low" | "zero" | "safe";
  active?: "0" | "1" | "all";
  sort?: string;
  status?: "PENDING" | "APPROVED" | "CANCELLED";
  from?: string;
  to?: string;
}) {
  const name = async (sql: string, id?: number) =>
    id ? ((await rows<{ v: string }>(sql, [id]))[0]?.v ?? `#${id}`) : null;
  const date = (d: string) => d.split("-").reverse().join("/");
  const parts = [
    f.active && { "1": "barang aktif", "0": "barang nonaktif", all: "barang aktif & nonaktif" }[f.active],
    f.stock && { low: "stok menipis", zero: "stok habis", safe: "stok aman" }[f.stock],
    f.sort &&
      {
        fast: "Fast moving",
        slow: "Slow moving",
        dead: "Dead stock",
        unlabelled: "belum diberi label",
      }[f.sort],
    ...(await Promise.all([
      name("SELECT name v FROM categories WHERE id=?", f.category_id).then((v) => v && `kategori ${v}`),
      name("SELECT name v FROM rooms WHERE id=?", f.room_id).then((v) => v && `ruangan ${v}`),
      name("SELECT code v FROM blocks WHERE id=?", f.block_id).then((v) => v && `blok ${v}`),
      name(
        "SELECT CONCAT(b.code,'.',LPAD(r.rack_number,2,'0')) v FROM racks r JOIN blocks b ON b.id=r.block_id WHERE r.id=?",
        f.rack_id,
      ).then((v) => v && `rak ${v}`),
      name("SELECT code v FROM locations WHERE id=?", f.location_id).then((v) => v && `posisi ${v}`),
      name("SELECT sku v FROM products WHERE id=?", f.product_id).then((v) => v && `barang ${v}`),
    ])),
    f.status && { APPROVED: "status selesai", PENDING: "status menunggu", CANCELLED: "status dibatalkan" }[f.status],
    f.from && f.to
      ? `tanggal ${date(f.from)} – ${date(f.to)}`
      : f.from
        ? `sejak ${date(f.from)}`
        : f.to && `sampai ${date(f.to)}`,
    f.q && `pencarian "${f.q}"`,
  ];
  return parts.filter((p): p is string => !!p);
}

type Numbered<T> = T & { no: number };
const numbered = <T>(items: T[]) => items.map((item, i) => ({ ...item, no: i + 1 }));
/** Keterangan baris kedua: jumlah data, filter yang dipakai, dan waktu unduh. */
const subtitle = (count: string, filters: string[]) => [
  [count, ...filters].join(" · "),
  `Diunduh ${describeTime(new Date())}`,
];

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

export async function productsWorkbook(items: InventoryProduct[], filters: string[]) {
  const wb = newWorkbook();
  writeTable(
    wb.addWorksheet("Data Barang", { properties: { tabColor: { argb: colors.brand } } }),
    {
      title: "DATA BARANG",
      subtitle: subtitle(`${items.length} barang`, filters),
      columns: productColumns,
      rows: numbered(items),
      freezeColumns: 3,
    },
  );
  return toBuffer(wb);
}

export type HistoryKind = "all" | "in" | "out" | "adjustments" | "reservations";
const historyTitles: Record<HistoryKind, string> = {
  all: "RIWAYAT SEMUA TRANSAKSI",
  in: "RIWAYAT BARANG MASUK",
  out: "RIWAYAT BARANG KELUAR",
  adjustments: "RIWAYAT KOREKSI STOK",
  reservations: "RIWAYAT NO RESERVASI (BARANG KELUAR)",
};

export async function historyWorkbook(
  kind: HistoryKind,
  items: StockTransaction[],
  filters: string[],
) {
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
  ];
  const wb = newWorkbook();
  writeTable(
    wb.addWorksheet("Riwayat", { properties: { tabColor: { argb: colors.brand } } }),
    {
      title: historyTitles[kind],
      subtitle: subtitle(`${items.length} transaksi`, filters),
      columns,
      rows: items,
      freezeColumns: 1,
    },
  );
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
  { header: "Sisa", width: 11, kind: "quantity", value: (r) => r.closing },
  {
    header: "Status Stok",
    width: 15,
    kind: "text",
    value: (r) => stockLabel(r.closing, r.min_stock),
    tone: (r) => stockTone[stockLabel(r.closing, r.min_stock)],
  },
  { header: "Transaksi", width: 10, kind: "integer", value: (r) => r.transactions || null },
];

export async function opnameWorkbook(
  day: string,
  items: OpnameRow[],
  filters: string[],
) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
  const wb = newWorkbook();
  writeTable(
    wb.addWorksheet("Opname", { properties: { tabColor: { argb: colors.brand } } }),
    {
      title: `OPNAME HARIAN · ${date.toUpperCase()}`,
      subtitle: [
        ...subtitle(`${items.length} barang`, filters),
        "Sisa = Stok Awal + Masuk − Keluar ± Koreksi. Kosong = tidak ada transaksi.",
      ],
      columns: opnameColumns,
      rows: numbered(items),
      freezeColumns: 3,
    },
  );
  return toBuffer(wb);
}
