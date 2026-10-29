import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import {
  buildBackupWorkbook,
  type BackupData,
} from "../src/services/excel-backup";
import {
  buildEmergencyTemplate,
  readEmergencyBook,
  type CatalogProduct,
} from "../src/services/emergency";
import { toBuffer } from "../src/lib/excel";
import { liveCsvFiles, liveWorkbookScript } from "../src/services/excel-live";
import {
  excelDay,
  excelTime,
  fillBook,
  FIRST_ROW,
} from "./helpers/emergency-book";
import type { StockTransaction } from "../src/types";

process.env.APP_TIMEZONE = "Asia/Jakarta";
const now = new Date("2026-10-26T07:45:10Z");
const products = [
  {
    sku: "00123",
    name: "BAUT M8",
    category_name: "Sparepart",
    room_name: "Ruangan 1",
    location_code: "A.01.01",
    stock: 120,
    min_stock: 2,
    unit: "Pcs",
    movement_class: "FAST",
    last_transaction_at: "2026-10-26 03:15:00.000",
  },
  {
    sku: "CB4A60001",
    name: "ELECTRODE",
    category_name: "Sparepart",
    room_name: "Ruangan 1",
    location_code: "B.05.05.008",
    stock: 548.8,
    min_stock: 600,
    unit: "Kg",
    movement_class: null,
    last_transaction_at: null,
  },
  {
    sku: "a0001",
    name: "KABEL",
    category_name: "Kabel",
    room_name: "Ruangan 3",
    location_code: "C.12.04",
    stock: 0,
    min_stock: 2,
    unit: "Roll",
    movement_class: "DEAD",
    last_transaction_at: null,
  },
] as BackupData["products"];
const tx = (t: Partial<StockTransaction>) =>
  ({
    room_name: "Ruangan 1",
    location_code: "A.01.01",
    unit: "Pcs",
    actor_name: "admin",
    notes: null,
    reservation_number: null,
    ...t,
  }) as StockTransaction;
const history = [
  tx({
    transaction_number: "OUT-20261026-0003",
    scanned_at: "2026-10-26 03:15:00.000",
    transaction_type: "OUT",
    status: "APPROVED",
    sku: "00123",
    name: "BAUT M8",
    quantity: 5,
    stock_before: 125,
    stock_after: 120,
    reservation_number: "0012345",
  }),
  tx({
    transaction_number: "IN-20261025-0001",
    scanned_at: "2026-10-25 09:00:00.000",
    transaction_type: "IN",
    status: "APPROVED",
    sku: "CB4A60001",
    name: "ELECTRODE",
    unit: "Kg",
    quantity: 0.3,
    stock_before: 548.5,
    stock_after: 548.8,
  }),
  tx({
    transaction_number: "ADJ-20261024-0001",
    scanned_at: "2026-10-24 02:00:00.000",
    transaction_type: "ADJUSTMENT",
    status: "APPROVED",
    sku: "00123",
    name: "BAUT M8",
    quantity: -2,
    stock_before: 127,
    stock_after: 125,
    notes: "Rusak",
  }),
  tx({
    transaction_number: "IN-20261023-0002",
    scanned_at: "2026-10-23 07:30:00.000",
    transaction_type: "IN",
    status: "CANCELLED",
    sku: "a0001",
    name: "KABEL",
    quantity: 3,
    stock_before: null,
    stock_after: null,
  }),
];
async function load(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb;
}
/** Baris tabel (header di baris `header`) sebagai objek {judul kolom: nilai}. */
function table(ws: ExcelJS.Worksheet, header: number) {
  const names = (ws.getRow(header).values as ExcelJS.CellValue[])
    .slice(1)
    .map(String);
  const out: Record<string, { value: ExcelJS.CellValue; numFmt: string }>[] =
    [];
  for (let r = header + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    out.push(
      Object.fromEntries(
        names.map((n, i) => [
          n,
          {
            value: row.getCell(i + 1).value,
            numFmt: row.getCell(i + 1).numFmt,
          },
        ]),
      ),
    );
  }
  return { names, rows: out };
}

test("cadangan Excel: setiap kolom berisi tipe & nilai yang sesuai", async () => {
  const wb = await load(
    await toBuffer(
      buildBackupWorkbook({
        products,
        history,
        generatedAt: now,
        since: new Date(now.getTime() - 90 * 86400000),
        days: 90,
      }),
    ),
  );
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ["Stok Barang", "Riwayat Transaksi", "Keterangan"],
  );

  const stock = table(wb.getWorksheet("Stok Barang")!, 5);
  assert.deepEqual(stock.names, [
    "No",
    "Kode Barang",
    "Nama Barang",
    "Kategori",
    "Ruangan",
    "Lokasi",
    "Stok",
    "Stok Minimal",
    "Satuan",
    "Status Stok",
    "Pergerakan",
    "Transaksi Terakhir",
  ]);
  const [baut, kg, kabel] = stock.rows;
  assert.equal(baut["No"].value, 1);
  // Kode barang tetap teks: nol di depan tidak hilang.
  assert.equal(baut["Kode Barang"].value, "00123");
  assert.equal(baut["Kode Barang"].numFmt, "@");
  assert.equal(baut["Stok"].value, 120);
  assert.equal(baut["Stok"].numFmt, "#,##0");
  assert.equal(kg["Stok"].value, 548.8);
  assert.equal(kg["Stok"].numFmt, "#,##0.0##");
  assert.equal(baut["Status Stok"].value, "AMAN");
  assert.equal(kabel["Status Stok"].value, "STOK HABIS");
  // Batas minimal per barang: 548,8 Kg dengan minimal 600 → menipis.
  assert.equal(kg["Stok Minimal"].value, 600);
  assert.equal(kg["Status Stok"].value, "STOK MENIPIS");
  assert.equal(baut["Pergerakan"].value, "Fast moving");
  assert.equal(kg["Pergerakan"].value, "Belum diberi label");
  assert.equal(kabel["Pergerakan"].value, "Dead stock");
  // Waktu database UTC 03:15 → 10:15 WIB, sebagai nilai tanggal Excel (bukan teks).
  assert.deepEqual(
    baut["Transaksi Terakhir"].value,
    new Date(Date.UTC(2026, 9, 26, 10, 15)),
  );
  assert.equal(kg["Transaksi Terakhir"].value, null);

  const hist = table(wb.getWorksheet("Riwayat Transaksi")!, 5);
  assert.deepEqual(hist.names, [
    "No Transaksi",
    "Tanggal",
    "Jam",
    "Jenis",
    "Kode Barang",
    "Nama Barang",
    "Ruangan",
    "Lokasi",
    "Perubahan Stok",
    "Satuan",
    "Stok Sebelum",
    "Stok Sesudah",
    "Status",
    "No Reservasi",
    "Kode Masuk",
    "Petugas",
    "Catatan",
  ]);
  const [out, inKg, adj, cancelled] = hist.rows;
  assert.deepEqual(out["Tanggal"].value, new Date(Date.UTC(2026, 9, 26)));
  assert.equal(out["Tanggal"].numFmt, "dd/mm/yyyy");
  // Nilai jam Excel (exceljs membacanya sebagai tanggal dasar 30/12/1899 + jam).
  assert.deepEqual(out["Jam"].value, new Date(Date.UTC(1899, 11, 30, 10, 15)));
  assert.equal(out["Jam"].numFmt, "hh:mm:ss");
  assert.deepEqual(
    [out["Jenis"].value, inKg["Jenis"].value, adj["Jenis"].value],
    ["Keluar", "Masuk", "Koreksi stok"],
  );
  // Perubahan stok bertanda: keluar negatif, masuk positif, koreksi = selisih.
  assert.deepEqual(
    [out, inKg, adj].map((r) => r["Perubahan Stok"].value),
    [-5, 0.3, -2],
  );
  assert.equal(out["Perubahan Stok"].numFmt, "+#,##0;-#,##0;0");
  assert.equal(out["No Reservasi"].value, "0012345");
  // Transaksi batal tidak mengubah stok: kolom stok kosong, status jelas.
  assert.equal(cancelled["Perubahan Stok"].value, null);
  assert.equal(cancelled["Stok Sebelum"].value, null);
  assert.equal(cancelled["Status"].value, "Dibatalkan");
  assert.equal(adj["Catatan"].value, "Rusak");
});

test("workbook live: CSV berisi nilai sesuai jenis kolom, Power Query memakai tipe tetap", () => {
  const files = liveCsvFiles({
    products,
    history,
    generatedAt: now,
    since: new Date(now.getTime() - 90 * 86400000),
    days: 90,
  });
  const [header, baut, kg] = files["stok.csv"]
    .replace("\uFEFF", "")
    .split("\r\n");
  assert.equal(header.split(",")[1], '"Kode Barang"');
  // Kode teks dikutip (nol di depan aman), stok angka polos, waktu WIB ISO.
  assert.equal(
    baut,
    '1,"00123","BAUT M8","Sparepart","Ruangan 1","A.01.01",120,2,"Pcs","AMAN","Fast moving",2026-10-26 10:15:00',
  );
  assert.ok(kg.includes(",548.8,"));
  const out = files["riwayat.csv"].split("\r\n")[1].split(",");
  assert.deepEqual(out.slice(0, 3), [
    '"OUT-20261026-0003"',
    "2026-10-26",
    "10:15:00",
  ]);
  assert.equal(out[8], "-5");
  assert.ok(files["riwayat.csv"].includes('"0012345"'));
  assert.equal(files["info.csv"].split("\r\n")[1], "2026-10-26 14:45:10,3,4");
  const script = liveWorkbookScript("C:\\Backup Gudang");
  assert.match(
    script,
    /File\.Contents\("C:\\Backup Gudang\\_data\\stok\.csv"\)/,
  );
  assert.match(script, /\{"Kode Barang", type text\}/);
  assert.match(script, /\{"Stok", type number\}/);
  assert.match(script, /\{"Tanggal", type date\}/);
  assert.match(script, /RefreshPeriod = 1/);
});

test("Excel live dari web: angka & tanggal lewat x:num, teks dikunci '@', aman dari HTML", async () => {
  const { feedTable } = await import("../src/services/excel-feed");
  const { stockColumns } = await import("../src/services/excel-backup");
  const html = feedTable(stockColumns, [
    { ...products[0], name: 'BAUT <M8> & "Ø"\nbaris2', no: 1 },
    { ...products[1], no: 2 },
  ]);
  assert.match(html, /<th>Kode Barang<\/th>/);
  assert.match(
    html,
    /<td x:num="1">1<\/td><td style="mso-number-format:'\\@'">00123<\/td>/,
  );
  assert.match(html, /BAUT &lt;M8&gt; &amp; &quot;Ø&quot; · baris2/);
  assert.match(html, /<td x:num="548.8">548.8<\/td>/);
  // 26/10/2026 10:15 WIB → nomor seri Excel 46321 + 10:15.
  const serial = Number(html.match(/<td x:num="(4632[0-9.]+)">/)![1]);
  assert.ok(Math.abs(serial - (46321 + (10 * 60 + 15) / 1440)) < 1e-6);
  assert.match(html, /<td><\/td><\/tr><\/table>/); // Transaksi Terakhir kosong
});

const catalog: CatalogProduct[] = [
  {
    sku: "00123",
    name: "BAUT M8",
    unit: "Pcs",
    room_name: "Ruangan 1",
    location_code: "A.01.01",
    stock: 120,
  },
  {
    sku: "CB4A60001",
    name: "ELECTRODE",
    unit: "Kg",
    room_name: "Ruangan 1",
    location_code: "B.05.05.008",
    stock: 548.8,
  },
];
const bookId = "3f2a6c1e-8a4b-4c2d-9e1f-0a1b2c3d4e5f";

test("template buku darurat: kolom, rumus, validasi, kunci, ID buku tersembunyi", async () => {
  const wb = await load(await buildEmergencyTemplate(catalog, { bookId, now }));
  assert.deepEqual(
    wb.worksheets.map((w) => [w.name, w.state]),
    [
      ["Catatan Darurat", "visible"],
      ["Daftar Barang", "visible"],
      ["_buku", "veryHidden"],
    ],
  );
  const ws = wb.getWorksheet("Catatan Darurat")!;
  const header = (ws.getRow(FIRST_ROW - 1).values as string[]).slice(1);
  assert.deepEqual(header, [
    "No",
    "Tanggal",
    "Jam",
    "Jenis",
    "Kode Barang",
    "Nama Barang",
    "Satuan",
    "Jumlah",
    "No Reservasi",
    "Petugas",
    "Catatan",
  ]);
  assert.equal(ws.getCell(`A${FIRST_ROW}`).value, 1);
  assert.equal(ws.getCell(`A${FIRST_ROW + 999}`).value, 1000);
  assert.match(
    String(
      (ws.getCell(`F${FIRST_ROW}`).value as ExcelJS.CellFormulaValue).formula,
    ),
    /VLOOKUP\(TRIM\(\$E7&""\),'Daftar Barang'!\$A:\$C,2,FALSE\)/,
  );
  // Kolom isian terbuka, kolom otomatis terkunci, sheet diproteksi.
  assert.equal(ws.getCell(`E${FIRST_ROW}`).protection?.locked, false);
  // Tanpa atribut = bawaan Excel: terkunci.
  assert.notEqual(ws.getCell(`F${FIRST_ROW}`).protection?.locked, false);
  assert.ok(
    (ws as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection
      ?.sheet,
  );
  assert.equal(ws.getCell(`E${FIRST_ROW}`).numFmt, "@");
  assert.equal(ws.getCell(`I${FIRST_ROW}`).numFmt, "@");
  assert.equal(ws.getCell(`B${FIRST_ROW}`).numFmt, "[$-421]dd mmm yyyy");
  assert.deepEqual(ws.getCell(`D${FIRST_ROW + 500}`).dataValidation?.formulae, [
    '"Masuk,Keluar"',
  ]);
  assert.equal(
    ws.getCell(`I${FIRST_ROW + 999}`).dataValidation?.type,
    "textLength",
  );
  // Validasi kode barang relatif ke baris pertama rentang (tidak bergeser).
  assert.match(
    String(ws.getCell(`E${FIRST_ROW}`).dataValidation?.formulae?.[0]),
    /TRIM\(E7&""\)/,
  );
  assert.equal(wb.getWorksheet("_buku")!.getCell("B1").value, bookId);
  const list = table(wb.getWorksheet("Daftar Barang")!, 5);
  assert.equal(list.rows[0]["Kode Barang"].value, "00123");
  assert.equal(list.rows[1]["Stok Saat File Dibuat"].value, 548.8);
});

test("buku darurat: tanggal/jam/kode/no reservasi dibaca sesuai isinya", async () => {
  const filled = await fillBook(
    await buildEmergencyTemplate(catalog, { bookId, now }),
    [
      {
        date: excelDay("2026-10-26"),
        time: excelTime(9, 15),
        type: "Keluar",
        sku: "00123",
        quantity: 5,
        reservation: "0012345",
        officer: "Budi",
        note: "Produksi",
      },
      // Diketik sebagai teks / angka: tetap terbaca benar.
      {
        date: "25/10/2026",
        time: "14.30",
        type: "masuk",
        sku: " CB4A60001 ",
        quantity: "0,3",
      },
      {
        date: excelDay("2026-10-26"),
        time: excelTime(10, 0),
        type: "Keluar",
        sku: "00123",
        quantity: 1,
        reservation: 12345,
      },
      {}, // baris kosong dilewati
      {
        date: excelDay("2026-10-26"),
        time: excelTime(10, 5),
        type: "Keluar",
        sku: "00123",
        quantity: 1,
      },
      {
        date: excelDay("2026-10-26"),
        time: excelTime(10, 6),
        type: "Masuk",
        sku: "00123",
        quantity: 2,
        reservation: "1234567",
      },
      { date: "31/02/2026", time: "25:00", type: "Pindah", quantity: 0 },
      {
        date: excelDay("2030-01-01"),
        time: excelTime(8, 0),
        type: "Masuk",
        sku: "00123",
        quantity: 1,
      },
    ],
  );
  const book = await readEmergencyBook(filled);
  assert.equal(book.bookId, bookId);
  assert.deepEqual(
    book.rows.map((r) => r.no),
    [1, 2, 3, 5, 6, 7, 8],
  );
  const [
    first,
    second,
    third,
    noReservation,
    inWithReservation,
    invalid,
    future,
  ] = book.rows;
  assert.deepEqual(
    { ...first, at: first.at?.toISOString() },
    {
      no: 1,
      line: FIRST_ROW,
      date: "2026-10-26",
      time: "09:15",
      at: "2026-10-26T02:15:00.000Z",
      type: "OUT",
      sku: "00123",
      quantity: 5,
      reservation: "0012345",
      officer: "Budi",
      note: "Produksi",
      problems: [],
    },
  );
  assert.equal(second.date, "2026-10-25");
  assert.equal(second.time, "14:30");
  assert.equal(second.type, "IN");
  assert.equal(second.sku, "CB4A60001");
  assert.equal(second.quantity, 0.3);
  assert.deepEqual(second.problems, []);
  // Angka di sel umum kehilangan nol depan; no reservasi selalu 7 angka, jadi dipulihkan.
  assert.equal(third.reservation, "0012345");
  assert.deepEqual(noReservation.problems, [
    "No reservasi wajib untuk barang keluar.",
  ]);
  assert.match(inWithReservation.problems.join(), /hanya untuk barang keluar/);
  assert.deepEqual(invalid.problems, [
    "Tanggal tidak valid (contoh 26/10/2026).",
    "Jam tidak valid (contoh 14:30).",
    "Jenis harus Masuk atau Keluar.",
    "Kode barang wajib diisi.",
    "Jumlah harus angka lebih dari 0.",
  ]);
  assert.match(future.problems.join(), /masa depan/);
});

test("buku darurat yang disimpan Microsoft Excel terbaca utuh", async () => {
  const book = await readEmergencyBook(
    readFileSync(
      new URL("./fixtures/buku-darurat-excel.xlsx", import.meta.url),
    ),
  );
  assert.equal(book.bookId, bookId);
  assert.deepEqual(
    book.rows.map((r) => [
      r.no,
      r.date,
      r.time,
      r.type,
      r.sku,
      r.quantity,
      r.reservation,
      r.officer,
      r.problems.length,
    ]),
    [
      [1, "2026-10-26", "09:15", "OUT", "00123", 5, "0012345", "Budi", 0],
      [2, "2026-10-26", "09:20", "IN", "CB4A60001", 0.3, null, "Budi", 0],
      [3, "2026-10-26", "10:00", "OUT", "XYZ999", 1, "1234567", "Sari", 0],
      [4, "2026-10-26", "10:05", "OUT", "PB1A00003", 1, null, "Sari", 1],
      [5, "2026-10-26", "10:10", "OUT", "a0001", 2, "7654321", "Sari", 0],
    ],
  );
});

test("file selain buku darurat ditolak dengan pesan jelas", async () => {
  await assert.rejects(readEmergencyBook(Buffer.from("bukan excel")), {
    code: "INVALID_FILE",
    message: /format \.xlsx/,
  });
  const other = new ExcelJS.Workbook();
  other.addWorksheet("Sheet1").getCell("A1").value = "Kode Barang";
  await assert.rejects(readEmergencyBook(await toBuffer(other)), {
    code: "INVALID_FILE",
    message: /bukan buku darurat/,
  });
});
