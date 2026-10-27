import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { rows, execute, transaction, publish } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { calculateStock } from "@/lib/stock";
import { sqlDateTime, zonedToUtc } from "@/lib/time";
import {
  bodyFont,
  codeFont,
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
import { lockedSelect, nextNumber, type LockedProduct } from "./transactions";
// Buku darurat: file Excel untuk mencatat barang masuk/keluar saat web & HP tidak bisa
// dipakai. Isinya PERGERAKAN (bukan angka stok), sehingga saat diunggah setiap baris
// menjadi transaksi biasa dan tidak menimpa perubahan lain yang terjadi bersamaan.
export const EMERGENCY_SHEET = "Catatan Darurat";
export const CATALOG_SHEET = "Daftar Barang";
const META_SHEET = "_buku";
export const EMERGENCY_ROWS = 1000;
const MAX_ROWS = 5000;
const headers = {
  no: "No",
  date: "Tanggal",
  time: "Jam",
  type: "Jenis",
  sku: "Kode Barang",
  name: "Nama Barang",
  unit: "Satuan",
  quantity: "Jumlah",
  reservation: "No Reservasi",
  officer: "Petugas",
  note: "Catatan",
} as const;
type Field = keyof typeof headers;
const order: Field[] = [
  "no",
  "date",
  "time",
  "type",
  "sku",
  "name",
  "unit",
  "quantity",
  "reservation",
  "officer",
  "note",
];
const widths: Record<Field, number> = {
  no: 6,
  date: 13,
  time: 9,
  type: 10,
  sku: 17,
  name: 40,
  unit: 9,
  quantity: 11,
  reservation: 14,
  officer: 16,
  note: 36,
};
/** Kolom yang diisi petugas; kolom lain terkunci (otomatis). */
const inputs: Field[] = [
  "date",
  "time",
  "type",
  "sku",
  "quantity",
  "reservation",
  "officer",
  "note",
];
const letter = (field: Field) => String.fromCharCode(65 + order.indexOf(field));

export type CatalogProduct = {
  sku: string;
  name: string;
  unit: string;
  room_name: string | null;
  location_code: string;
  stock: number;
};
export function emergencyCatalog() {
  return rows<CatalogProduct>(
    `SELECT p.sku,p.name,p.unit,rm.name room_name,l.code location_code,p.stock FROM products p JOIN locations l ON l.id=p.location_id${hierarchyJoins} WHERE p.active=1 ORDER BY p.name,p.sku`,
  );
}
const catalogColumns: Column<CatalogProduct>[] = [
  { header: "Kode Barang", width: 17, kind: "code", value: (p) => p.sku },
  { header: "Nama Barang", width: 46, kind: "text", value: (p) => p.name },
  { header: "Satuan", width: 9, kind: "text", value: (p) => p.unit },
  { header: "Ruangan", width: 18, kind: "text", value: (p) => p.room_name },
  { header: "Lokasi", width: 16, kind: "code", value: (p) => p.location_code },
  {
    header: "Stok Saat File Dibuat",
    width: 14,
    kind: "quantity",
    value: (p) => p.stock,
  },
];

export async function buildEmergencyTemplate(
  products: CatalogProduct[],
  { bookId = randomUUID(), now = new Date() } = {},
) {
  const wb = newWorkbook();
  const ws = wb.addWorksheet(EMERGENCY_SHEET, {
    properties: { tabColor: { argb: "FFB91C1C" } },
  });
  order.forEach((f, i) => (ws.getColumn(i + 1).width = widths[f]));
  const headerRow = writeHeading(
    ws,
    order.length,
    "BUKU DARURAT BARANG MASUK / KELUAR",
    [
      "Isi hanya saat web atau aplikasi HP tidak bisa dipakai. Satu baris = satu barang masuk atau keluar. Kolom putih diisi petugas; kolom abu-abu terisi otomatis.",
      "Tanggal hari ini: tekan Ctrl+;  ·  Jam sekarang: tekan Ctrl+Shift+;  ·  Barang Keluar wajib No Reservasi 7 angka.",
      "Setelah web normal: buka web → Pengaturan → Buku darurat → unggah file ini. Baris yang sudah tersimpan tidak akan tercatat dua kali.",
    ],
  );
  const header = ws.getRow(headerRow);
  order.forEach((f, i) => (header.getCell(i + 1).value = headers[f]));
  styleHeader(header);
  const first = headerRow + 1;
  const last = headerRow + EMERGENCY_ROWS;
  const catalog = `'${CATALOG_SHEET}'!$A:$C`;
  for (let r = first; r <= last; r++) {
    const row = ws.getRow(r);
    row.height = 18;
    const sku = `$${letter("sku")}${r}`;
    order.forEach((f, i) => {
      const cell = row.getCell(i + 1);
      const editable = inputs.includes(f);
      cell.border = thinBorder;
      cell.font = f === "sku" || f === "reservation" ? codeFont : bodyFont;
      cell.protection = { locked: !editable };
      cell.fill = solid(editable ? colors.input : colors.locked);
      cell.alignment = {
        vertical: "middle",
        horizontal:
          f === "no" || f === "quantity"
            ? "right"
            : f === "date" || f === "time" || f === "type"
              ? "center"
              : "left",
      };
    });
    row.getCell(1).value = r - headerRow;
    row.getCell(1).numFmt = "0";
    // Nama bulan (Indonesia) agar salah baca hari/bulan langsung terlihat, apa pun format Windows-nya.
    row.getCell(order.indexOf("date") + 1).numFmt = "[$-421]dd mmm yyyy";
    row.getCell(order.indexOf("time") + 1).numFmt = "hh:mm";
    row.getCell(order.indexOf("quantity") + 1).numFmt = "General";
    for (const f of [
      "type",
      "sku",
      "reservation",
      "officer",
      "note",
    ] as Field[])
      row.getCell(order.indexOf(f) + 1).numFmt = "@";
    // Nama & satuan dicari dari sheet Daftar Barang; kode salah ketik langsung terlihat.
    row.getCell(order.indexOf("name") + 1).value = {
      formula: `IF(${sku}="","",IFERROR(VLOOKUP(TRIM(${sku}&""),${catalog},2,FALSE),"KODE TIDAK DITEMUKAN"))`,
    };
    row.getCell(order.indexOf("unit") + 1).value = {
      formula: `IF(${sku}="","",IFERROR(VLOOKUP(TRIM(${sku}&""),${catalog},3,FALSE),""))`,
    };
  }
  const range = (f: Field) => `${letter(f)}${first}:${letter(f)}${last}`;
  // Satu aturan per rentang kolom: rumus relatif (mis. E5) selalu mengacu ke baris pertama rentang.
  const validations = (
    ws as unknown as {
      dataValidations: {
        add(range: string, rule: ExcelJS.DataValidation): void;
      };
    }
  ).dataValidations;
  const dv = (f: Field, rule: ExcelJS.DataValidation) =>
    validations.add(range(f), rule);
  dv("date", {
    type: "date",
    operator: "greaterThan",
    allowBlank: true,
    formulae: [new Date(Date.UTC(2020, 0, 1))],
    showInputMessage: true,
    promptTitle: "Tanggal",
    prompt:
      "Tekan Ctrl+; untuk tanggal hari ini, atau ketik seperti 2026-10-26.",
    showErrorMessage: true,
    errorTitle: "Tanggal tidak valid",
    error:
      "Tekan Ctrl+; untuk tanggal hari ini, atau ketik seperti 2026-10-26.",
  });
  dv("time", {
    type: "decimal",
    operator: "between",
    allowBlank: true,
    formulae: [0, 0.99999],
    showInputMessage: true,
    promptTitle: "Jam",
    prompt: "Tekan Ctrl+Shift+; untuk jam sekarang, atau ketik seperti 14:30.",
    showErrorMessage: true,
    errorTitle: "Jam tidak valid",
    error:
      "Tekan Ctrl+Shift+; untuk jam sekarang, atau ketik seperti 14:30 (pakai titik dua).",
  });
  dv("type", {
    type: "list",
    allowBlank: true,
    formulae: ['"Masuk,Keluar"'],
    showErrorMessage: true,
    errorTitle: "Jenis tidak valid",
    error: "Pilih Masuk atau Keluar.",
  });
  dv("sku", {
    type: "custom",
    allowBlank: true,
    formulae: [
      `COUNTIF('${CATALOG_SHEET}'!$A:$A,TRIM(${letter("sku")}${first}&""))>0`,
    ],
    showErrorMessage: true,
    errorStyle: "warning",
    errorTitle: "Kode barang tidak ada di Daftar Barang",
    error:
      "Periksa kode barang. Pilih Yes bila barang ini memang baru dan belum ada di daftar.",
  });
  dv("quantity", {
    type: "decimal",
    operator: "greaterThan",
    allowBlank: true,
    formulae: [0],
    showErrorMessage: true,
    errorTitle: "Jumlah tidak valid",
    error: "Isi jumlah lebih dari 0. Hanya satuan Kg yang boleh berkoma.",
  });
  dv("reservation", {
    type: "textLength",
    operator: "equal",
    allowBlank: true,
    formulae: [7],
    showErrorMessage: true,
    errorTitle: "No reservasi tidak valid",
    error: "No reservasi harus tepat 7 angka (untuk barang Keluar).",
  });
  ws.addConditionalFormatting({
    ref: range("name"),
    rules: [
      {
        type: "containsText",
        operator: "containsText",
        text: "TIDAK DITEMUKAN",
        priority: 1,
        style: { font: { bold: true, color: { argb: "FFB91C1C" } } },
      },
    ],
  });
  ws.addConditionalFormatting({
    ref: range("reservation"),
    rules: [
      {
        type: "expression",
        priority: 2,
        formulae: [
          `AND($${letter("type")}${first}="Keluar",$${letter("reservation")}${first}="")`,
        ],
        style: {
          fill: {
            type: "pattern",
            pattern: "solid",
            bgColor: { argb: "FFFEE2E2" },
          },
        },
      },
    ],
  });
  ws.views = [
    { state: "frozen", xSplit: 1, ySplit: headerRow, showGridLines: false },
  ];
  ws.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${headerRow}:${headerRow}`,
  };
  ws.headerFooter = { oddFooter: "&L&8&A&R&8Halaman &P dari &N" };
  await ws.protect("", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatColumns: true,
    formatRows: true,
  });

  const list = wb.addWorksheet(CATALOG_SHEET);
  writeTable(list, {
    title: "DAFTAR BARANG",
    subtitle: [
      `Per ${describeTime(now)} · ${products.length} barang aktif · dipakai untuk mengisi Nama Barang & Satuan otomatis.`,
      "Stok di sheet ini adalah stok saat file dibuat, bukan stok terbaru.",
    ],
    columns: catalogColumns,
    rows: products,
    freezeColumns: 1,
  });
  await list.protect("", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatColumns: true,
    autoFilter: true,
  });

  const meta = wb.addWorksheet(META_SHEET, { state: "veryHidden" });
  meta.getCell("A1").value = "book_id";
  meta.getCell("B1").value = bookId;
  meta.getCell("A2").value = "created_at";
  meta.getCell("B2").value = now.toISOString();
  return toBuffer(wb);
}

// ---------- Membaca file yang sudah diisi ----------
export type EmergencyRow = {
  no: number;
  /** Nomor baris di Excel, untuk pesan kesalahan. */
  line: number;
  date: string | null; // "2026-10-26" (zona aplikasi)
  time: string | null; // "14:30"
  at: Date | null; // titik waktu UTC
  type: "IN" | "OUT" | null;
  sku: string;
  quantity: number | null;
  reservation: string | null;
  officer: string;
  note: string;
  problems: string[];
};
export type EmergencyBook = { bookId: string; rows: EmergencyRow[] };
function plain(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("result" in value) return plain(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return value.text;
    if ("error" in value) return null;
    if ("formula" in value || "sharedFormula" in value) return null;
  }
  return value;
}
function text(value: ExcelJS.CellValue) {
  const v = plain(value);
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
const pad = (n: number) => String(n).padStart(2, "0");
/** Tanggal dari sel Excel (nilai tanggal, nomor seri, atau teks dd/mm/yyyy). */
export function parseDate(
  value: ExcelJS.CellValue,
): { year: number; month: number; day: number } | null {
  const v = plain(value);
  let y: number, m: number, d: number;
  if (v instanceof Date) {
    [y, m, d] = [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()];
  } else if (typeof v === "number" && v >= 1) {
    const date = new Date(Math.round((Math.floor(v) - 25569) * 86400000));
    [y, m, d] = [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    ];
  } else if (typeof v === "string") {
    const s = v.trim();
    let match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (match) {
      [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
      if (y < 100) y += 2000;
    } else if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
      [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else return null;
  } else return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  )
    return null;
  return { year: y, month: m, day: d };
}
/** Jam dari sel Excel (nilai jam, pecahan hari, atau teks 14:30 / 14.30). */
export function parseTime(
  value: ExcelJS.CellValue,
): { hour: number; minute: number; second: number } | null {
  const v = plain(value);
  let seconds: number;
  if (v instanceof Date) {
    seconds = Math.round(
      (((v.getTime() % 86400000) + 86400000) % 86400000) / 1000,
    );
  } else if (typeof v === "number" && v >= 0) {
    seconds = Math.round((v - Math.floor(v)) * 86400);
  } else if (typeof v === "string") {
    const match = v.trim().match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/);
    if (!match) return null;
    const [h, mi, s] = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3] ?? 0),
    ];
    if (h > 23 || mi > 59 || s > 59) return null;
    seconds = h * 3600 + mi * 60 + s;
  } else return null;
  seconds %= 86400;
  return {
    hour: Math.floor(seconds / 3600),
    minute: Math.floor((seconds % 3600) / 60),
    second: seconds % 60,
  };
}
function parseType(value: ExcelJS.CellValue): "IN" | "OUT" | null {
  const v = text(value).toLowerCase();
  if (["masuk", "in", "m"].includes(v)) return "IN";
  if (["keluar", "out", "k"].includes(v)) return "OUT";
  return null;
}
function parseQuantity(value: ExcelJS.CellValue) {
  const v = plain(value);
  if (typeof v === "number") return v;
  const s = text(value);
  if (!/^\d+([.,]\d+)?$/.test(s)) return null;
  return Number(s.replace(",", "."));
}
/** No reservasi selalu 7 angka; angka yang kehilangan nol di depan (sel angka) dipulihkan. */
function parseReservation(value: ExcelJS.CellValue) {
  const v = plain(value);
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e7)
    return String(v).padStart(7, "0");
  return text(value);
}
export async function readEmergencyBook(
  buffer: Buffer | ArrayBuffer,
): Promise<EmergencyBook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as ExcelJS.Buffer);
  } catch {
    throw new AppError(
      "INVALID_FILE",
      "File tidak bisa dibaca. Pastikan file berformat .xlsx (Excel).",
    );
  }
  const bookId = text(wb.getWorksheet(META_SHEET)?.getCell("B1").value ?? null);
  const ws = wb.getWorksheet(EMERGENCY_SHEET);
  if (!ws || !/^[0-9a-f-]{36}$/i.test(bookId))
    throw new AppError(
      "INVALID_FILE",
      "File ini bukan buku darurat dari sistem. Unduh template di Pengaturan → Buku darurat.",
    );
  // Cari baris header & posisi kolom berdasarkan judulnya.
  const columns = new Map<Field, number>();
  let headerRow = 0;
  for (let r = 1; r <= 15 && !headerRow; r++) {
    const row = ws.getRow(r);
    const names = new Map<string, number>();
    row.eachCell((cell, col) => names.set(text(cell.value).toLowerCase(), col));
    if (!names.has(headers.sku.toLowerCase())) continue;
    headerRow = r;
    for (const f of order) {
      const col = names.get(headers[f].toLowerCase());
      if (col) columns.set(f, col);
    }
  }
  const missing = order.filter(
    (f) => !columns.has(f) && f !== "name" && f !== "unit",
  );
  if (!headerRow || missing.length)
    throw new AppError(
      "INVALID_FILE",
      `Kolom buku darurat tidak lengkap${missing.length ? `: ${missing.map((f) => headers[f]).join(", ")}` : ""}.`,
    );
  const get = (row: ExcelJS.Row, f: Field) =>
    row.getCell(columns.get(f)!).value;
  const result: EmergencyRow[] = [];
  const seen = new Set<number>();
  const now = Date.now();
  const lastRow = Math.min(ws.rowCount, headerRow + MAX_ROWS);
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (inputs.every((f) => text(get(row, f)) === "")) continue; // baris kosong
    const problems: string[] = [];
    const noValue = Number(plain(get(row, "no")));
    const no =
      Number.isInteger(noValue) && noValue > 0 ? noValue : r - headerRow;
    if (seen.has(no)) problems.push(`No ${no} dipakai lebih dari satu baris.`);
    seen.add(no);
    const date = parseDate(get(row, "date"));
    const time = parseTime(get(row, "time"));
    if (!date)
      problems.push(
        text(get(row, "date"))
          ? "Tanggal tidak valid (contoh 26/10/2026)."
          : "Tanggal wajib diisi.",
      );
    if (!time)
      problems.push(
        text(get(row, "time"))
          ? "Jam tidak valid (contoh 14:30)."
          : "Jam wajib diisi.",
      );
    const at = date && time ? zonedToUtc({ ...date, ...time }) : null;
    if (at && at.getTime() > now + 10 * 60000)
      problems.push("Waktu di masa depan. Periksa tanggal dan jam.");
    const type = parseType(get(row, "type"));
    if (!type)
      problems.push(
        text(get(row, "type"))
          ? "Jenis harus Masuk atau Keluar."
          : "Jenis wajib diisi (Masuk/Keluar).",
      );
    const sku = text(get(row, "sku"));
    if (!sku) problems.push("Kode barang wajib diisi.");
    const quantity = parseQuantity(get(row, "quantity"));
    if (quantity === null || !(quantity > 0))
      problems.push(
        text(get(row, "quantity"))
          ? "Jumlah harus angka lebih dari 0."
          : "Jumlah wajib diisi.",
      );
    const reservation = parseReservation(get(row, "reservation")) || null;
    if (reservation && !/^\d{7}$/.test(reservation))
      problems.push("No reservasi harus tepat 7 angka.");
    if (type === "OUT" && !reservation)
      problems.push("No reservasi wajib untuk barang keluar.");
    if (type === "IN" && reservation)
      problems.push(
        "No reservasi hanya untuk barang keluar. Kosongkan atau ubah Jenis.",
      );
    result.push({
      no,
      line: r,
      date: date ? `${date.year}-${pad(date.month)}-${pad(date.day)}` : null,
      time: time ? `${pad(time.hour)}:${pad(time.minute)}` : null,
      at,
      type,
      sku,
      quantity,
      reservation,
      officer: text(get(row, "officer")).slice(0, 100),
      note: text(get(row, "note")).slice(0, 500),
      problems,
    });
  }
  return { bookId: bookId.toLowerCase(), rows: result };
}

// ---------- Impor: pratinjau atau simpan ----------
export type EmergencyStatus =
  "ready" | "saved" | "imported" | "conflict" | "error";
export type EmergencyResult = Omit<EmergencyRow, "at" | "problems"> & {
  name: string | null;
  unit: string | null;
  status: EmergencyStatus;
  message: string;
  transaction_number: string | null;
  stock_before: number | null;
  stock_after: number | null;
};
/** Kunci unik per baris buku: unggah ulang file yang sama tidak mencatat baris dua kali. */
export function emergencyRef(bookId: string, no: number) {
  return (
    "excel:" +
    createHash("sha256").update(`${bookId}:${no}`).digest("hex").slice(0, 40)
  );
}
type Existing = {
  client_ref: string;
  transaction_number: string;
  product_id: number;
  transaction_type: string;
  quantity: number | null;
  reservation_number: string | null;
};
const placeholders = (n: number) => Array(n).fill("?").join(",");
/**
 * Baris diproses urut waktu kejadian. Setiap baris diperiksa seperti transaksi HP
 * (barang aktif, stok cukup, no reservasi). Baris bermasalah dilewati dan dilaporkan;
 * baris lain tetap tersimpan. `apply: false` = pratinjau, tidak ada yang disimpan.
 */
export async function importEmergency(
  book: EmergencyBook,
  user: { id: number; username: string },
  { apply }: { apply: boolean },
) {
  const sorted = [...book.rows].sort(
    (a, b) =>
      (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity) ||
      a.no - b.no,
  );
  const results = await transaction(
    async (conn) => {
      const skus = [...new Set(book.rows.map((r) => r.sku).filter(Boolean))];
      // Kunci semua barang yang terlibat sekaligus, urut id (urutan lock sama dengan jalur lain).
      const products = skus.length
        ? await rows<LockedProduct>(
            `${lockedSelect} WHERE p.sku IN (${placeholders(skus.length)}) ORDER BY p.id FOR UPDATE`,
            skus,
            conn,
          )
        : [];
      const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
      const pending = new Map<number, string>();
      if (products.length)
        for (const t of await rows<{
          product_id: number;
          transaction_number: string;
        }>(
          `SELECT product_id,transaction_number FROM stock_transactions WHERE status='PENDING' AND product_id IN (${placeholders(products.length)})`,
          products.map((p) => p.id),
          conn,
        ))
          pending.set(t.product_id, t.transaction_number);
      const refs = book.rows.map((r) => emergencyRef(book.bookId, r.no));
      const existing = new Map(
        (refs.length
          ? await rows<Existing>(
              `SELECT client_ref,transaction_number,product_id,transaction_type,quantity,reservation_number FROM stock_transactions WHERE client_ref IN (${placeholders(refs.length)})`,
              refs,
              conn,
            )
          : []
        ).map((t) => [t.client_ref, t]),
      );
      const stock = new Map(products.map((p) => [p.id, p.stock]));
      const out: EmergencyResult[] = [];
      for (const row of sorted) {
        const { at: _at, problems, ...fields } = row;
        const p = bySku.get(row.sku.toLowerCase());
        const base: EmergencyResult = {
          ...fields,
          name: p?.name ?? null,
          unit: p?.unit ?? null,
          status: "error",
          message: "",
          transaction_number: null,
          stock_before: null,
          stock_after: null,
        };
        const fail = (message: string) => out.push({ ...base, message });
        if (problems.length) {
          fail(problems.join(" "));
          continue;
        }
        const done = existing.get(emergencyRef(book.bookId, row.no));
        if (done) {
          const same =
            done.product_id === p?.id &&
            done.transaction_type === row.type &&
            done.quantity === row.quantity &&
            (done.reservation_number ?? null) === row.reservation;
          out.push({
            ...base,
            status: same ? "imported" : "conflict",
            transaction_number: done.transaction_number,
            message: same
              ? `Sudah tersimpan sebelumnya (${done.transaction_number}).`
              : `No ${row.no} sudah tersimpan sebagai ${done.transaction_number} dengan isi berbeda. Perbaiki lewat Revisi di menu Riwayat.`,
          });
          continue;
        }
        if (!p) {
          fail("Kode barang tidak terdaftar di web.");
          continue;
        }
        if (!p.active) {
          fail("Barang sudah tidak aktif.");
          continue;
        }
        if (pending.has(p.id)) {
          fail(
            `Barang masih punya transaksi menunggu (${pending.get(p.id)}). Selesaikan dulu di Dashboard.`,
          );
          continue;
        }
        const type = row.type!;
        const before = stock.get(p.id)!;
        let after: number;
        try {
          after = calculateStock(before, row.quantity!, type, p.unit);
        } catch (error) {
          if (error instanceof AppError) {
            fail(error.message);
            continue;
          }
          throw error;
        }
        stock.set(p.id, after);
        let number: string | null = null;
        if (apply) {
          number = await nextNumber(type, conn, row.date!);
          const when = sqlDateTime(row.at!);
          const notes = [
            `Buku darurat No ${row.no}`,
            row.officer && `dicatat oleh ${row.officer}`,
            row.note && `catatan: ${row.note}`,
            `diunggah oleh ${user.username}`,
          ]
            .filter(Boolean)
            .join(" · ");
          await execute(
            "UPDATE products SET stock=? WHERE id=?",
            [after, p.id],
            conn,
          );
          await execute(
            "INSERT INTO stock_transactions(transaction_number,product_id,location_id,location_code,room_name,transaction_type,quantity,stock_before,stock_after,status,reservation_number,client_ref,notes,scanned_at,approved_at,actor_id) VALUES (?,?,?,?,?,?,?,?,?,'APPROVED',?,?,?,?,?,?)",
            [
              number,
              p.id,
              p.location_id,
              p.location_code,
              p.room_name,
              type,
              row.quantity,
              before,
              after,
              row.reservation,
              emergencyRef(book.bookId, row.no),
              notes,
              when,
              when,
              user.id,
            ],
            conn,
          );
        }
        out.push({
          ...base,
          status: apply ? "saved" : "ready",
          message: apply ? `Tersimpan sebagai ${number}.` : "Siap disimpan.",
          transaction_number: number,
          stock_before: before,
          stock_after: after,
        });
      }
      if (apply && out.some((r) => r.status === "saved"))
        await publish(conn, "emergency");
      return out;
    },
    { dryRun: !apply },
  );
  results.sort((a, b) => a.no - b.no);
  const count = (s: EmergencyStatus) =>
    results.filter((r) => r.status === s).length;
  return {
    rows: results,
    summary: {
      total: results.length,
      ready: count("ready"),
      saved: count("saved"),
      imported: count("imported"),
      conflict: count("conflict"),
      error: count("error"),
    },
  };
}
export async function emergencyTemplateBuffer() {
  return buildEmergencyTemplate(await emergencyCatalog());
}
