import ExcelJS from "exceljs";
import { appTimezone, fromSqlDateTime, wallClock } from "./time";
// Satu gaya untuk semua file Excel (cadangan & buku darurat). Setiap kolom menyatakan
// jenis isinya, sehingga nilai selalu ditulis dengan tipe Excel yang benar:
// kode/no reservasi tetap teks (nol di depan tidak hilang), stok angka, tanggal & jam
// berupa nilai tanggal/jam Excel (bisa difilter dan diurutkan), bukan teks.
export type ColumnKind =
  | "text" // teks biasa
  | "code" // kode (barang, lokasi, transaksi, reservasi): teks, huruf monospace
  | "integer" // bilangan bulat, mis. nomor urut
  | "quantity" // jumlah/stok: bulat atau berkoma (Kg)
  | "signed" // perubahan stok: +5 / -3
  | "date" // tanggal (dd/mm/yyyy)
  | "time" // jam (hh:mm:ss)
  | "datetime"; // tanggal + jam
export type Column<T> = {
  header: string;
  width: number;
  kind: ColumnKind;
  value: (row: T) => unknown;
  /** Warna latar & huruf per sel, mis. status stok. */
  tone?: (row: T) => Tone | undefined;
};
export type Tone = "good" | "warn" | "bad" | "muted" | "info" | "accent";
export const colors = {
  brand: "FF047857",
  title: "FF0F172A",
  subtle: "FF64748B",
  border: "FFE2E8F0",
  band: "FFF8FAFC",
  locked: "FFF1F5F9",
  input: "FFFFFFFF",
};
const tones: Record<Tone, { fill: string; font: string }> = {
  good: { fill: "FFDCFCE7", font: "FF15803D" },
  warn: { fill: "FFFEF3C7", font: "FFB45309" },
  bad: { fill: "FFFEE2E2", font: "FFB91C1C" },
  muted: { fill: "FFF1F5F9", font: "FF64748B" },
  info: { fill: "FFDBEAFE", font: "FF1D4ED8" },
  accent: { fill: "FFEDE9FE", font: "FF6D28D9" },
};
export const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: colors.border } },
  left: { style: "thin", color: { argb: colors.border } },
  bottom: { style: "thin", color: { argb: colors.border } },
  right: { style: "thin", color: { argb: colors.border } },
};
export const solid = (argb: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});
const isInteger = (value: number) => Math.abs(value - Math.round(value)) < 1e-9;
/** Format angka per sel: bulat tanpa koma, berkoma (Kg) maks. 3 desimal tanpa titik menggantung. */
export function quantityFormat(value: number, signed = false) {
  const base = isInteger(value) ? "#,##0" : "#,##0.0##";
  return signed ? `+${base};-${base};0` : base;
}
/** Waktu UTC dari database → nilai tanggal Excel berjam dinding zona aplikasi. */
export function excelDateTime(value: string | Date) {
  const w = wallClock(
    typeof value === "string" ? fromSqlDateTime(value) : value,
  );
  return new Date(
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second),
  );
}
export function excelDate(value: string | Date) {
  const w = wallClock(
    typeof value === "string" ? fromSqlDateTime(value) : value,
  );
  return new Date(Date.UTC(w.year, w.month - 1, w.day));
}
/** Jam sebagai pecahan hari, format jam Excel. */
export function excelTime(value: string | Date) {
  const w = wallClock(
    typeof value === "string" ? fromSqlDateTime(value) : value,
  );
  return (w.hour * 3600 + w.minute * 60 + w.second) / 86400;
}
/** Nilai sel sesuai jenis kolom; null = sel kosong. */
export function cellValue(kind: ColumnKind, raw: unknown): ExcelJS.CellValue {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (kind) {
    case "text":
    case "code":
      return String(raw);
    case "integer":
    case "quantity":
    case "signed": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case "date":
      return raw instanceof Date || typeof raw === "string"
        ? excelDate(raw)
        : null;
    case "time":
      return raw instanceof Date || typeof raw === "string"
        ? excelTime(raw)
        : null;
    case "datetime":
      return raw instanceof Date || typeof raw === "string"
        ? excelDateTime(raw)
        : null;
  }
}
function numFmt(kind: ColumnKind, value: ExcelJS.CellValue) {
  switch (kind) {
    case "text":
    case "code":
      return "@";
    case "integer":
      return "0";
    case "quantity":
      return quantityFormat(typeof value === "number" ? value : 0);
    case "signed":
      return quantityFormat(typeof value === "number" ? value : 0, true);
    case "date":
      return "dd/mm/yyyy";
    case "time":
      return "hh:mm:ss";
    case "datetime":
      return "dd/mm/yyyy hh:mm";
  }
}
export function alignment(kind: ColumnKind): Partial<ExcelJS.Alignment> {
  if (kind === "integer" || kind === "quantity" || kind === "signed")
    return { horizontal: "right", vertical: "middle" };
  if (kind === "date" || kind === "time" || kind === "datetime")
    return { horizontal: "center", vertical: "middle" };
  return { horizontal: "left", vertical: "middle" };
}
export const codeFont: Partial<ExcelJS.Font> = { name: "Consolas", size: 10 };
export const bodyFont: Partial<ExcelJS.Font> = { name: "Calibri", size: 10.5 };
/** Judul (baris 1) dan keterangan (baris 2) di atas tabel. */
export function writeHeading(
  ws: ExcelJS.Worksheet,
  width: number,
  title: string,
  subtitle: string[],
) {
  const last = ws.getColumn(width).letter;
  ws.mergeCells(`A1:${last}1`);
  const t = ws.getCell("A1");
  t.value = title;
  t.font = {
    name: "Calibri",
    size: 15,
    bold: true,
    color: { argb: colors.title },
  };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;
  subtitle.forEach((line, i) => {
    const row = 2 + i;
    ws.mergeCells(`A${row}:${last}${row}`);
    const c = ws.getCell(`A${row}`);
    c.value = line;
    c.font = {
      name: "Calibri",
      size: 10,
      italic: true,
      color: { argb: colors.subtle },
    };
    c.alignment = { vertical: "middle", wrapText: true };
    ws.getRow(row).height = 18;
  });
  return 2 + subtitle.length + 1; // baris kosong lalu header tabel
}
export function styleHeader(row: ExcelJS.Row) {
  row.height = 30;
  row.eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      size: 10.5,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = solid(colors.brand);
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.border = thinBorder;
  });
}
/**
 * Tabel rapi: judul, header hijau tebal, kolom selebar isinya, baris belang tipis,
 * header & kolom kiri dibekukan, filter di setiap header, siap cetak landscape.
 */
export function writeTable<T>(
  ws: ExcelJS.Worksheet,
  options: {
    title: string;
    subtitle: string[];
    columns: Column<T>[];
    rows: T[];
    /** Jumlah kolom kiri yang dibekukan saat digeser ke kanan. */
    freezeColumns?: number;
  },
) {
  const { columns, rows } = options;
  columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  const headerRow = writeHeading(
    ws,
    columns.length,
    options.title,
    options.subtitle,
  );
  const header = ws.getRow(headerRow);
  columns.forEach((c, i) => (header.getCell(i + 1).value = c.header));
  styleHeader(header);
  rows.forEach((item, index) => {
    const row = ws.getRow(headerRow + 1 + index);
    row.height = 18;
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const value = cellValue(c.kind, c.value(item));
      cell.value = value;
      cell.numFmt = numFmt(c.kind, value);
      cell.font = c.kind === "code" ? codeFont : bodyFont;
      cell.alignment = alignment(c.kind);
      cell.border = thinBorder;
      const tone = c.tone?.(item);
      if (tone) {
        cell.fill = solid(tones[tone].fill);
        cell.font = {
          ...cell.font,
          bold: true,
          color: { argb: tones[tone].font },
        };
      } else if (index % 2 === 1) cell.fill = solid(colors.band);
    });
  });
  const lastRow = headerRow + Math.max(rows.length, 1);
  const lastCol = ws.getColumn(columns.length).letter;
  ws.autoFilter = `A${headerRow}:${lastCol}${lastRow}`;
  ws.views = [
    {
      state: "frozen",
      xSplit: options.freezeColumns ?? 0,
      ySplit: headerRow,
      showGridLines: false,
    },
  ];
  ws.pageSetup = {
    orientation: "landscape",
    paperSize: 9, // A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${headerRow}:${headerRow}`,
    margins: {
      left: 0.4,
      right: 0.4,
      top: 0.5,
      bottom: 0.5,
      header: 0.3,
      footer: 0.3,
    },
  };
  ws.headerFooter = { oddFooter: "&L&8&A&R&8Halaman &P dari &N" };
  return headerRow;
}
/** Tanggal & jam untuk teks keterangan, mis. "Senin, 26 Okt 2026 14.30 WIB". */
export function describeTime(date: Date) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: appTimezone(),
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
export function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Warehouse Stock Management";
  wb.created = new Date();
  wb.modified = new Date();
  // Rumus (mis. nama barang di buku darurat) dihitung Excel saat file dibuka.
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}
export async function toBuffer(wb: ExcelJS.Workbook) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export const xlsxType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** Respons unduhan .xlsx. */
export function xlsxResponse(buffer: Buffer, filename: string) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": xlsxType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
