import type ExcelJS from "exceljs";
import { rows } from "@/lib/db";
import { stockLabel } from "@/lib/stock";
import { sqlDateTime } from "@/lib/time";
import {
  bodyFont,
  colors,
  describeTime,
  newWorkbook,
  solid,
  styleHeader,
  thinBorder,
  toBuffer,
  writeHeading,
  writeTable,
  type Column,
} from "@/lib/excel";
import { hierarchyJoins } from "./locations";
import { transactionSelect } from "./transactions";
import type { Product, StockTransaction } from "@/types";
// Cadangan Excel satu arah (database → file): stok terakhir dan riwayat transaksi
// untuk dibuka saat web tidak bisa diakses. File ini tidak pernah dibaca balik ke web.
export type BackupProduct = Pick<
  Product,
  | "sku"
  | "name"
  | "category_name"
  | "room_name"
  | "location_code"
  | "stock"
  | "unit"
  | "movement_class"
> & { last_transaction_at: string | null };
export type BackupData = {
  products: BackupProduct[];
  history: StockTransaction[];
  generatedAt: Date;
  since: Date;
  days: number;
};
export const historyDays = () =>
  Math.min(3650, Math.max(1, Number(process.env.EXCEL_HISTORY_DAYS) || 90));
/** Stok terakhir semua barang aktif, urut nama. */
export function backupProducts() {
  return rows<BackupProduct>(
    `SELECT p.sku,p.name,c.name category_name,rm.name room_name,l.code location_code,p.stock,p.unit,p.movement_class,lt.last_at last_transaction_at
     FROM products p JOIN categories c ON c.id=p.category_id JOIN locations l ON l.id=p.location_id${hierarchyJoins}
     LEFT JOIN (SELECT product_id,MAX(scanned_at) last_at FROM stock_transactions WHERE status='APPROVED' GROUP BY product_id) lt ON lt.product_id=p.id
     WHERE p.active=1 ORDER BY p.name,p.sku`,
  );
}
/** Riwayat transaksi sejak `since`, terbaru di atas. */
export function backupHistory(since: Date) {
  return rows<StockTransaction>(
    transactionSelect +
      " WHERE t.scanned_at>=? ORDER BY t.scanned_at DESC,t.id DESC",
    [sqlDateTime(since)],
  );
}
export async function loadBackupData(
  days = historyDays(),
): Promise<BackupData> {
  const generatedAt = new Date();
  const since = new Date(generatedAt.getTime() - days * 86400000);
  const [products, history] = await Promise.all([
    backupProducts(),
    backupHistory(since),
  ]);
  return { products, history, generatedAt, since, days };
}
export const movementLabel = (m: Product["movement_class"]) =>
  m === "FAST"
    ? "Fast moving"
    : m === "SLOW"
      ? "Slow moving"
      : m === "DEAD"
        ? "Dead stock"
        : "Belum diberi label";
const typeLabel = { IN: "Masuk", OUT: "Keluar", ADJUSTMENT: "Koreksi stok" };
const statusLabel = {
  APPROVED: "Selesai",
  PENDING: "Menunggu",
  CANCELLED: "Dibatalkan",
};
/** Perubahan stok bertanda: hanya transaksi selesai yang benar-benar mengubah stok. */
export function stockChange(t: StockTransaction) {
  if (t.status !== "APPROVED" || t.quantity === null) return null;
  if (t.transaction_type === "OUT") return -t.quantity;
  return t.quantity; // IN positif; koreksi sudah bertanda (selisih)
}
export const stockColumns: Column<BackupProduct & { no: number }>[] = [
  { header: "No", width: 6, kind: "integer", value: (p) => p.no },
  { header: "Kode Barang", width: 16, kind: "code", value: (p) => p.sku },
  { header: "Nama Barang", width: 46, kind: "text", value: (p) => p.name },
  {
    header: "Kategori",
    width: 16,
    kind: "text",
    value: (p) => p.category_name,
  },
  { header: "Ruangan", width: 18, kind: "text", value: (p) => p.room_name },
  { header: "Lokasi", width: 16, kind: "code", value: (p) => p.location_code },
  { header: "Stok", width: 12, kind: "quantity", value: (p) => p.stock },
  { header: "Satuan", width: 9, kind: "text", value: (p) => p.unit },
  {
    header: "Status Stok",
    width: 15,
    kind: "text",
    value: (p) => stockLabel(p.stock),
    tone: (p) => (p.stock === 0 ? "bad" : p.stock <= 2 ? "warn" : "good"),
  },
  {
    header: "Pergerakan",
    width: 17,
    kind: "text",
    value: (p) => movementLabel(p.movement_class),
  },
  {
    header: "Transaksi Terakhir",
    width: 18,
    kind: "datetime",
    value: (p) => p.last_transaction_at,
  },
];
export const historyColumns: Column<StockTransaction>[] = [
  {
    header: "No Transaksi",
    width: 20,
    kind: "code",
    value: (t) => t.transaction_number,
  },
  { header: "Tanggal", width: 12, kind: "date", value: (t) => t.scanned_at },
  { header: "Jam", width: 10, kind: "time", value: (t) => t.scanned_at },
  {
    header: "Jenis",
    width: 13,
    kind: "text",
    value: (t) => typeLabel[t.transaction_type],
    // Warna sama dengan web: masuk hijau, keluar biru, koreksi ungu.
    tone: (t) =>
      t.transaction_type === "IN"
        ? "good"
        : t.transaction_type === "OUT"
          ? "info"
          : "accent",
  },
  { header: "Kode Barang", width: 16, kind: "code", value: (t) => t.sku },
  { header: "Nama Barang", width: 40, kind: "text", value: (t) => t.name },
  // Ruangan & lokasi saat transaksi terjadi (snapshot), bukan lokasi barang sekarang.
  { header: "Ruangan", width: 16, kind: "text", value: (t) => t.room_name },
  { header: "Lokasi", width: 16, kind: "code", value: (t) => t.location_code },
  { header: "Perubahan Stok", width: 12, kind: "signed", value: stockChange },
  { header: "Satuan", width: 9, kind: "text", value: (t) => t.unit },
  {
    header: "Stok Sebelum",
    width: 12,
    kind: "quantity",
    value: (t) => (t.status === "APPROVED" ? t.stock_before : null),
  },
  {
    header: "Stok Sesudah",
    width: 12,
    kind: "quantity",
    value: (t) => (t.status === "APPROVED" ? t.stock_after : null),
  },
  {
    header: "Status",
    width: 12,
    kind: "text",
    value: (t) => statusLabel[t.status],
    tone: (t) => (t.status === "APPROVED" ? undefined : "muted"),
  },
  {
    header: "No Reservasi",
    width: 13,
    kind: "code",
    value: (t) => t.reservation_number,
  },
  { header: "Kode Masuk", width: 15, kind: "code", value: (t) => t.in_code },
  { header: "Petugas", width: 14, kind: "text", value: (t) => t.actor_name },
  { header: "Catatan", width: 50, kind: "text", value: (t) => t.notes },
];
function writeNotes(ws: ExcelJS.Worksheet, data: BackupData, updated: string) {
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 100;
  const start = writeHeading(ws, 2, "KETERANGAN FILE CADANGAN", [
    `Diperbarui: ${updated}`,
  ]);
  const header = ws.getRow(start);
  header.getCell(1).value = "Bagian";
  header.getCell(2).value = "Penjelasan";
  styleHeader(header);
  const notes: [string, string][] = [
    [
      "Fungsi file",
      "Cadangan otomatis data gudang untuk dibuka saat web tidak bisa diakses.",
    ],
    [
      "Sheet Stok Barang",
      `Stok terakhir ${data.products.length} barang aktif, urut nama A–Z.`,
    ],
    [
      "Sheet Riwayat Transaksi",
      `${data.history.length} transaksi dalam ${data.days} hari terakhir, terbaru di atas. Ruangan & lokasi adalah posisi barang saat transaksi terjadi.`,
    ],
    [
      "Perubahan Stok",
      "+ berarti stok bertambah, - berarti stok berkurang. Kosong untuk transaksi yang menunggu/dibatalkan (stok tidak berubah).",
    ],
    [
      "Status Stok",
      "STOK HABIS = 0, STOK MENIPIS = sisa 2 atau kurang, AMAN = lebih dari 2.",
    ],
    [
      "Pembaruan",
      "Program Backup Excel di komputer ini menulis ulang file setiap ada perubahan data. File terbuka sebagai Read-Only sehingga tetap diperbarui walau sedang dibuka. Tutup lalu buka lagi untuk melihat data terbaru.",
    ],
    [
      "Saat web tidak bisa dibuka",
      "Lihat stok di sheet Stok Barang. Catat barang masuk/keluar di file buku-darurat.xlsx (satu folder dengan file ini). Setelah web normal, unggah di web: Pengaturan → Buku darurat.",
    ],
    [
      "Penting",
      "Jangan mengubah file ini. Perubahan di file ini TIDAK dikirim ke web dan akan tertimpa pada pembaruan berikutnya.",
    ],
  ];
  notes.forEach(([label, text], i) => {
    const row = ws.getRow(start + 1 + i);
    row.getCell(1).value = label;
    row.getCell(2).value = text;
    row.getCell(1).font = { ...bodyFont, bold: true };
    row.getCell(2).font = bodyFont;
    for (const c of [1, 2]) {
      const cell = row.getCell(c);
      cell.border = thinBorder;
      cell.alignment = { vertical: "top", wrapText: true };
      if (i % 2 === 1) cell.fill = solid(colors.band);
    }
  });
  ws.views = [{ state: "normal", showGridLines: false }];
  ws.pageSetup = {
    orientation: "portrait",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
}
export function buildBackupWorkbook(data: BackupData) {
  const wb = newWorkbook();
  const updated = describeTime(data.generatedAt);
  writeTable(
    wb.addWorksheet("Stok Barang", {
      properties: { tabColor: { argb: colors.brand } },
    }),
    {
      title: "STOK BARANG GUDANG",
      subtitle: [
        `Per ${updated} · ${data.products.length} barang aktif`,
        "Cadangan otomatis dari database web. Jangan diedit — perubahan di file ini tidak masuk ke web.",
      ],
      columns: stockColumns,
      rows: data.products.map((p, i) => ({ ...p, no: i + 1 })),
      freezeColumns: 3,
    },
  );
  writeTable(wb.addWorksheet("Riwayat Transaksi"), {
    title: "RIWAYAT TRANSAKSI",
    subtitle: [
      `${data.history.length} transaksi sejak ${describeTime(data.since)} (${data.days} hari terakhir) · terbaru di atas`,
      `Per ${updated}`,
    ],
    columns: historyColumns,
    rows: data.history,
    freezeColumns: 1,
  });
  writeNotes(wb.addWorksheet("Keterangan"), data, updated);
  return wb;
}
export async function backupWorkbookBuffer() {
  return toBuffer(buildBackupWorkbook(await loadBackupData()));
}
