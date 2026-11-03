import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  historyWorkbook,
  opnameWorkbook,
  productsWorkbook,
} from "../src/services/exports";
import {
  labelPdfSchema,
  listSchema,
  MAX_LABELS,
  opnameSchema,
} from "../src/validators";
import type { InventoryProduct, OpnameRow, StockTransaction } from "../src/types";

process.env.APP_TIMEZONE = "Asia/Jakarta";
const HEADER = 5; // judul, 2 baris keterangan, baris kosong, header

async function sheet(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets[0];
}
const headers = (ws: ExcelJS.Worksheet, row = HEADER) =>
  (ws.getRow(row).values as unknown[]).slice(1);

const tx = (t: Partial<StockTransaction>) =>
  ({
    room_name: "Ruangan 1",
    location_code: "A.01.01",
    unit: "Pcs",
    actor_name: "admin",
    notes: null,
    reservation_number: null,
    in_code: null,
    status: "APPROVED",
    ...t,
  }) as StockTransaction;

test("history export: Indonesian headers, WIB date & time, formulas stay text", async () => {
  const items = [
    tx({
      transaction_number: "OUT-20261103-0001",
      transaction_type: "OUT",
      scanned_at: "2026-11-02 17:30:00.000", // 3 Nov 00.30 WIB
      sku: "00123",
      name: '=HYPERLINK("x")',
      quantity: 4,
      stock_before: 10,
      stock_after: 6,
      reservation_number: "0012345",
    }),
  ];
  const ws = await sheet(await historyWorkbook("reservations", items, ["pencarian \"0012345\""]));
  assert.equal(ws.getCell("A1").value, "RIWAYAT NO RESERVASI (BARANG KELUAR)");
  assert.equal(ws.getCell("A2").value, '1 transaksi · pencarian "0012345"');
  // No reservasi di kolom pertama; tab ini tidak punya kolom Jenis / Kode Masuk.
  assert.deepEqual(headers(ws).slice(0, 4), ["No Reservasi", "No Transaksi", "Tanggal", "Jam"]);
  assert.ok(!headers(ws).includes("Jenis") && !headers(ws).includes("Kode Masuk"));
  const row = ws.getRow(HEADER + 1);
  assert.equal(row.getCell(1).value, "0012345", "nol di depan tetap ada");
  assert.deepEqual(row.getCell(3).value, new Date(Date.UTC(2026, 10, 3)));
  assert.equal(row.getCell(3).numFmt, "dd/mm/yyyy");
  // Sel jam dibaca kembali oleh ExcelJS sebagai tanggal 30/12/1899 + jam.
  assert.equal((row.getCell(4).value as Date).toISOString().slice(11, 19), "00:30:00", "00.30 WIB");
  const name = row.getCell(headers(ws).indexOf("Nama Barang") + 1);
  assert.equal(name.value, '=HYPERLINK("x")', "teks, bukan rumus");
  assert.equal(name.type, ExcelJS.ValueType.String);
  assert.equal(row.getCell(headers(ws).indexOf("Perubahan Stok") + 1).value, -4);

  const all = await sheet(
    await historyWorkbook(
      "all",
      [tx({ transaction_number: "ADJ-1", transaction_type: "ADJUSTMENT", scanned_at: "2026-11-03 01:00:00.000", quantity: -5, stock_before: 8, stock_after: 3 })],
      [],
    ),
  );
  assert.equal(all.getCell("A1").value, "RIWAYAT SEMUA TRANSAKSI");
  assert.ok(headers(all).includes("Jenis") && headers(all).includes("Kode Masuk"));
  const change = all.getRow(HEADER + 1).getCell(headers(all).indexOf("Perubahan Stok") + 1);
  assert.equal(change.value, -5);
  assert.match(change.numFmt, /^\+/, "tanda +/- tampil");
});

test("products export: one row per product with stock status and active state", async () => {
  const product = {
    sku: "00123",
    name: "BAUT M8",
    category_name: "Sparepart",
    room_name: "Ruangan 1",
    block_code: "A",
    location_code: "A.01.01",
    stock: 1,
    min_stock: 2,
    unit: "Pcs",
    movement_class: "FAST",
    out_total: 40,
    active: 0,
  } as InventoryProduct;
  const ws = await sheet(await productsWorkbook([product], ["stok menipis"]));
  assert.equal(ws.getCell("A1").value, "DATA BARANG");
  assert.equal(ws.getCell("A2").value, "1 barang · stok menipis");
  const row = Object.fromEntries(
    headers(ws).map((h, i) => [h, ws.getRow(HEADER + 1).getCell(i + 1).value]),
  );
  assert.deepEqual(
    [row["No"], row["Kode Barang"], row["Blok"], row["Stok"], row["Status Stok"], row["Pergerakan"], row["Status Barang"]],
    [1, "00123", "A", 1, "STOK MENIPIS", "Fast moving", "Nonaktif"],
  );
});

test("opname export: opening, in, out, correction, remaining; empty when no movement", async () => {
  const rows = [
    { sku: "00123", name: "BAUT M8", category_name: "Sparepart", location_code: "A.01.01", unit: "Pcs", min_stock: 2, opening: 10, incoming: 5, outgoing: 12, adjustment: -1, closing: 2, transactions: 3 },
    { sku: "CB4A60001", name: "ELECTRODE", category_name: "Sparepart", location_code: "B.05.05", unit: "Kg", min_stock: 2, opening: 548.8, incoming: 0, outgoing: 0, adjustment: 0, closing: 548.8, transactions: 0 },
  ] as OpnameRow[];
  const ws = await sheet(await opnameWorkbook("2026-11-03", rows, ["barang yang ada transaksi"]));
  assert.equal(ws.getCell("A1").value, "OPNAME HARIAN · SELASA, 3 NOVEMBER 2026");
  assert.deepEqual(headers(ws, HEADER + 1), [
    "No", "Kode Barang", "Nama Barang", "Kategori", "Lokasi", "Satuan",
    "Stok Awal", "Masuk", "Keluar", "Koreksi", "Sisa", "Status Stok", "Transaksi",
  ]);
  const value = (r: number, h: string) =>
    ws.getRow(HEADER + 1 + r).getCell(headers(ws, HEADER + 1).indexOf(h) + 1).value;
  assert.deepEqual(
    ["Stok Awal", "Masuk", "Keluar", "Koreksi", "Sisa", "Status Stok"].map((h) => value(1, h)),
    [10, 5, 12, -1, 2, "STOK MENIPIS"],
  );
  assert.deepEqual(
    ["Stok Awal", "Masuk", "Keluar", "Koreksi", "Sisa", "Transaksi"].map((h) => value(2, h)),
    [548.8, null, null, null, 548.8, null],
  );
});

test("export, opname and bulk label inputs", () => {
  assert.equal(listSchema.safeParse({ export: "csv" }).success, false, "CSV diganti Excel");
  assert.equal(listSchema.parse({ export: "xlsx" }).export, "xlsx");
  assert.deepEqual(opnameSchema.parse({}), { q: "", all: "0", sort: "location", page: 1, limit: 50 });
  assert.equal(opnameSchema.safeParse({ date: "3-11-2026" }).success, false);
  assert.deepEqual(labelPdfSchema.parse({ ids: "3,1,3" }), { ids: [3, 1], layout: "sheet", location: "1" });
  assert.equal(labelPdfSchema.parse({ ids: "7", layout: "roll", location: "0" }).layout, "roll");
  for (const ids of ["", "1,,2", "1;2", "0", "x"])
    assert.equal(labelPdfSchema.safeParse({ ids }).success, false, ids);
  const many = Array.from({ length: MAX_LABELS + 1 }, (_, i) => i + 1).join(",");
  assert.equal(labelPdfSchema.safeParse({ ids: many }).success, false);
});
