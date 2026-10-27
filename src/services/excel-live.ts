import { join } from "node:path";
import { cellValue, type Column, type ColumnKind } from "@/lib/excel";
import { historyColumns, stockColumns, type BackupData } from "./excel-backup";
// Workbook "live": dibuka sekali di Excel, lalu angkanya berubah sendiri. Program
// Backup Excel menulis data mentah (CSV) ke folder _data; workbook mengambilnya lewat
// Power Query dengan tipe kolom tetap, lalu di-refresh setiap ada perubahan.
export const LIVE_FILE = "stok-gudang-live.xlsx";
export const LIVE_DATA_DIR = "_data";
type Sheet<T> = { query: string; file: string; columns: Column<T>[] };
const info: Column<BackupData>[] = [
  {
    header: "Diperbarui",
    width: 20,
    kind: "datetime",
    value: (d) => d.generatedAt,
  },
  {
    header: "Barang Aktif",
    width: 14,
    kind: "integer",
    value: (d) => d.products.length,
  },
  {
    header: "Transaksi di Riwayat",
    width: 20,
    kind: "integer",
    value: (d) => d.history.length,
  },
];
const sheets = {
  info: { query: "Info", file: "info.csv", columns: info },
  stock: { query: "Stok", file: "stok.csv", columns: stockColumns },
  history: { query: "Riwayat", file: "riwayat.csv", columns: historyColumns },
};
const pad = (n: number) => String(n).padStart(2, "0");
/** Nilai CSV sesuai jenis kolom; tanggal/jam berupa jam dinding zona aplikasi. */
function csvCell(kind: ColumnKind, raw: unknown) {
  const v = cellValue(kind, raw);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const iso = v.toISOString();
    return kind === "date"
      ? iso.slice(0, 10)
      : iso.slice(0, 19).replace("T", " ");
  }
  if (kind === "time" && typeof v === "number") {
    const s = Math.round(v * 86400);
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
  if (typeof v === "number") return String(v);
  return '"' + String(v).replaceAll('"', '""') + '"';
}
function toCsv<T>(columns: Column<T>[], rows: T[]) {
  const header = columns.map((c) => '"' + c.header + '"').join(",");
  const body = rows.map((r) =>
    columns.map((c) => csvCell(c.kind, c.value(r))).join(","),
  );
  return "﻿" + [header, ...body].join("\r\n") + "\r\n";
}
/** File CSV untuk folder _data: { nama file: isi }. */
export function liveCsvFiles(data: BackupData) {
  return {
    [sheets.info.file]: toCsv(info, [data]),
    [sheets.stock.file]: toCsv(
      stockColumns,
      data.products.map((p, i) => ({ ...p, no: i + 1 })),
    ),
    [sheets.history.file]: toCsv(historyColumns, data.history),
  };
}
const mType: Record<ColumnKind, string> = {
  text: "type text",
  code: "type text",
  integer: "Int64.Type",
  quantity: "type number",
  signed: "type number",
  date: "type date",
  time: "type time",
  datetime: "type datetime",
};
const xlFormat: Record<ColumnKind, string> = {
  text: "@",
  code: "@",
  integer: "0",
  quantity: "General",
  signed: "+General;-General;0",
  date: "dd/mm/yyyy",
  time: "hh:mm:ss",
  datetime: "dd/mm/yyyy hh:mm",
};
/** Rumus Power Query: baca CSV (UTF-8) dengan tipe kolom tetap, angka & tanggal format en-US/ISO. */
function mFormula<T>(sheet: Sheet<T>, dataDir: string) {
  const types = sheet.columns
    .map((c) => `{"${c.header}", ${mType[c.kind]}}`)
    .join(", ");
  return [
    "let",
    `    Source = Csv.Document(File.Contents("${join(dataDir, sheet.file)}"), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),`,
    "    Headers = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),",
    `    Typed = Table.TransformColumnTypes(Headers, {${types}}, "en-US")`,
    "in",
    "    Typed",
  ].join("\r\n");
}
/** Warna ARGB → nilai warna Excel COM (BGR). */
const bgr = (argb: string) => {
  const [r, g, b] = [2, 4, 6].map((i) => parseInt(argb.slice(i, i + 2), 16));
  return b * 65536 + g * 256 + r;
};
const ps = (s: string) => "'" + s.replaceAll("'", "''") + "'";
/** Aturan warna sama dengan file cadangan & web. */
const highlights = {
  stock: {
    column: "Status Stok",
    rules: [
      ["STOK HABIS", "FFFEE2E2", "FFB91C1C"],
      ["STOK MENIPIS", "FFFEF3C7", "FFB45309"],
      ["AMAN", "FFDCFCE7", "FF15803D"],
    ],
  },
  history: {
    column: "Jenis",
    rules: [
      ["Masuk", "FFDCFCE7", "FF15803D"],
      ["Keluar", "FFDBEAFE", "FF1D4ED8"],
      ["Koreksi stok", "FFEDE9FE", "FF6D28D9"],
    ],
  },
};
/**
 * Skrip PowerShell yang membuat workbook live lewat Excel (COM): query Power Query,
 * tabel hijau, format & lebar kolom, warna status, refresh saat dibuka & tiap 1 menit.
 */
export function liveWorkbookScript(dir: string) {
  const dataDir = join(dir, LIVE_DATA_DIR);
  const table = <T>(
    sheet: Sheet<T>,
    ws: string,
    cell: string,
    highlight?: { column: string; rules: string[][] },
  ) => {
    const formats = sheet.columns.map((c) => ps(xlFormat[c.kind])).join(",");
    const widths = sheet.columns.map((c) => c.width).join(",");
    const rules = highlight
      ? highlight.rules
          .map(
            ([text, fill, font]) => `@(${ps(text)},${bgr(fill)},${bgr(font)})`,
          )
          .join(",")
      : "";
    return `Add-Table ${ws} ${ps(sheet.query)} ${ps(mFormula(sheet, dataDir))} ${ps(cell)} @(${formats}) @(${widths}) ${highlight ? sheet.columns.findIndex((c) => c.header === highlight.column) + 1 : 0} @(${rules}) $${sheet === sheets.info}`;
  };
  return `$ErrorActionPreference = 'Stop'
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
function Add-Table($ws, $name, $formula, $cell, $formats, $widths, $highlightCol, $rules, $oneRow) {
  [void]$wb.Queries.Add($name, $formula)
  $conn = "OLEDB;Provider=Microsoft.Mashup.OleDb.1;Data Source=$('$')Workbook$('$');Location=$name;Extended Properties=" + '""'
  $lo = $ws.ListObjects.Add(0, $conn, $true, 1, $ws.Range($cell))
  $qt = $lo.QueryTable
  $qt.CommandType = 2
  $qt.CommandText = @("SELECT * FROM [$name]")
  $qt.PreserveFormatting = $true
  $qt.AdjustColumnWidth = $false
  $qt.RefreshStyle = $(if ($oneRow) { 0 } else { 1 })
  $qt.BackgroundQuery = $false
  $qt.Refresh($false) | Out-Null
  $lo.Name = $name
  $lo.TableStyle = 'TableStyleMedium7'
  $c = $qt.WorkbookConnection.OLEDBConnection
  $c.RefreshOnFileOpen = $true
  $c.RefreshPeriod = 1
  $c.BackgroundQuery = $true
  $first = $lo.HeaderRowRange.Row + 1
  for ($i = 0; $i -lt $formats.Count; $i++) {
    $col = $lo.HeaderRowRange.Column + $i
    # Tabel besar: format per kolom utuh (ringkas). Tabel info 1 baris: format per sel.
    if ($oneRow) { $ws.Cells.Item($first, $col).NumberFormat = $formats[$i] }
    else { $ws.Columns.Item($col).NumberFormat = $formats[$i] }
    # Tabel utama: lebar persis. Tabel info: hanya melebarkan bila perlu.
    if ($oneRow) { $ws.Columns.Item($col).ColumnWidth = [Math]::Max($ws.Columns.Item($col).ColumnWidth, $widths[$i]) }
    else { $ws.Columns.Item($col).ColumnWidth = [double]$widths[$i] }
  }
  $lo.HeaderRowRange.NumberFormat = 'General'
  if ($highlightCol -gt 0) {
    $col = $lo.HeaderRowRange.Column + $highlightCol - 1
    $range = $ws.Columns.Item($col)
    foreach ($r in $rules) {
      $fc = $range.FormatConditions.Add(1, 3, '="' + $r[0] + '"')
      $fc.Interior.Color = $r[1]
      $fc.Font.Color = $r[2]
      $fc.Font.Bold = $true
    }
  }
  $lo.HeaderRowRange.Font.Bold = $true
}
try {
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 2) { [void]$wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
  while ($wb.Worksheets.Count -gt 2) { $wb.Worksheets.Item($wb.Worksheets.Count).Delete() }
  $stok = $wb.Worksheets.Item(1); $stok.Name = 'Stok Barang'
  $riwayat = $wb.Worksheets.Item(2); $riwayat.Name = 'Riwayat Transaksi'
  foreach ($s in @(@($stok, 'STOK BARANG GUDANG (LIVE)'), @($riwayat, 'RIWAYAT TRANSAKSI (LIVE)'))) {
    $s[0].Range('A1').Value2 = $s[1]
    $s[0].Range('A1').Font.Size = 15
    $s[0].Range('A1').Font.Bold = $true
  }
  $stok.Range('D1').Value2 = 'Berubah sendiri setiap ada transaksi (dan tiap 1 menit). Jangan diedit: perubahan di file ini tidak masuk ke web.'
  $stok.Range('D1').Font.Italic = $true
  $stok.Range('D1').Font.Color = ${bgr("FF64748B")}
  ${table(sheets.stock, "$stok", "A5", highlights.stock)}
  ${table(sheets.info, "$stok", "C2")}
  ${table(sheets.history, "$riwayat", "A3", highlights.history)}
  foreach ($s in @(@($riwayat, 3, 1), @($stok, 5, 3))) {
    $s[0].Activate()
    $w = $xl.ActiveWindow
    if ($w) { $w.FreezePanes = $false; $w.SplitRow = $s[1]; $w.SplitColumn = $s[2]; $w.FreezePanes = $true; $w.DisplayGridlines = $false }
    # Cetak: A4 landscape, selebar 1 halaman, header tabel diulang tiap halaman.
    try {
      $p = $s[0].PageSetup
      $p.Orientation = 2
      $p.PaperSize = 9
      $p.Zoom = $false
      $p.FitToPagesWide = 1
      $p.FitToPagesTall = $false
      $p.PrintTitleRows = '$' + $s[1] + ':$' + $s[1]
    } catch { }
  }
  $stok.Activate()
  $wb.SaveAs(${ps(join(dir, LIVE_FILE))}, 51)
  $wb.Close($false)
} finally {
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
`;
}
/** Skrip PowerShell: minta Excel yang sedang membuka workbook live untuk refresh sekarang. */
export const liveRefreshScript = `try { $xl = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch { exit 0 }
foreach ($wb in @($xl.Workbooks)) { if ($wb.Name -ieq '${LIVE_FILE}') { try { $wb.RefreshAll() } catch { } } }
`;
