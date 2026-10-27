import ExcelJS from "exceljs";
// Mengisi template buku darurat seperti petugas mengetik di Excel.
type Field =
  | "date"
  | "time"
  | "type"
  | "sku"
  | "quantity"
  | "reservation"
  | "officer"
  | "note";
export type FillRow = Partial<Record<Field, ExcelJS.CellValue>>;
const columns: Record<Field, string> = {
  date: "B",
  time: "C",
  type: "D",
  sku: "E",
  quantity: "H",
  reservation: "I",
  officer: "J",
  note: "K",
};
/** Baris data pertama (header tabel di baris 6). */
export const FIRST_ROW = 7;
export async function fillBook(
  template: Buffer,
  rows: FillRow[],
  start = FIRST_ROW,
) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet("Catatan Darurat")!;
  rows.forEach((row, i) => {
    for (const [field, value] of Object.entries(row))
      ws.getCell(`${columns[field as Field]}${start + i}`).value = value;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
/** Nilai tanggal Excel (tanpa jam) untuk "2026-10-26". */
export function excelDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
/** Nilai jam Excel (pecahan hari). */
export const excelTime = (hour: number, minute: number) =>
  (hour * 60 + minute) / 1440;
