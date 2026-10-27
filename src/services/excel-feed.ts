import { createHash, randomBytes } from "node:crypto";
import type ExcelJS from "exceljs";
import JSZip from "jszip";
import { execute, rows } from "@/lib/db";
import {
  bodyFont,
  codeFont,
  colors,
  newWorkbook,
  styleHeader,
  toBuffer,
  cellValue,
  type Column,
  type ColumnKind,
} from "@/lib/excel";
import {
  backupHistory,
  backupProducts,
  historyColumns,
  historyDays,
  stockColumns,
  type BackupProduct,
} from "./excel-backup";
import { highlights, xlFormat } from "./excel-live";
import type { StockTransaction } from "@/types";
// "Excel live" dari web: file .xlsx yang diunduh dari Pengaturan berisi koneksi web
// (fitur bawaan Excel) ke halaman data di server ini. Excel di PC mana pun mengambil
// data terbaru sendiri saat dibuka dan setiap menit, tanpa program tambahan.
// Halaman data memakai kunci baca-saja (hanya hash yang disimpan, bisa dicabut).

// ---------- Kunci akses ----------
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function createFeedToken(userId: number) {
  const token = randomBytes(24).toString("hex");
  await execute(
    "INSERT INTO excel_feed_tokens(token_hash,user_id) VALUES (?,?)",
    [tokenHash(token), userId],
  );
  return token;
}
/** true bila kunci masih berlaku (sekaligus mencatat waktu terakhir dipakai). */
export async function checkFeedToken(token: string) {
  if (!/^[0-9a-f]{48}$/.test(token)) return false;
  const result = await execute(
    "UPDATE excel_feed_tokens SET last_used_at=UTC_TIMESTAMP(3) WHERE token_hash=?",
    [tokenHash(token)],
  );
  return result.affectedRows > 0;
}
export async function feedTokenStatus() {
  const [status] = await rows<{ active: number; last_used_at: string | null }>(
    "SELECT COUNT(*) active,MAX(last_used_at) last_used_at FROM excel_feed_tokens",
  );
  return status;
}
/** Cabut semua kunci: file Excel live yang sudah diunduh berhenti mendapat data. */
export async function revokeFeedTokens() {
  return (await execute("DELETE FROM excel_feed_tokens")).affectedRows;
}

// ---------- Data per tabel ----------
type Info = { updated: Date; products: number; history: number };
const infoColumns: Column<Info>[] = [
  {
    header: "Diperbarui",
    width: 20,
    kind: "datetime",
    value: (d) => d.updated,
  },
  {
    header: "Barang Aktif",
    width: 14,
    kind: "integer",
    value: (d) => d.products,
  },
  {
    header: "Transaksi di Riwayat",
    width: 20,
    kind: "integer",
    value: (d) => d.history,
  },
];
type Feed<T> = {
  name: string;
  sheet: number;
  /** Kolom & baris kiri atas tabel. */
  column: number;
  row: number;
  columns: Column<T>[];
  load: () => Promise<T[]>;
  highlight?: { column: string; rules: string[][] };
};
const since = () => new Date(Date.now() - historyDays() * 86400000);
const feeds = {
  stok: {
    name: "Stok",
    sheet: 0,
    column: 1,
    row: 5,
    columns: stockColumns,
    load: async () =>
      (await backupProducts()).map((p, i) => ({ ...p, no: i + 1 })),
    highlight: highlights.stock,
  } satisfies Feed<BackupProduct & { no: number }>,
  info: {
    name: "Info",
    sheet: 0,
    column: 3,
    row: 2,
    columns: infoColumns,
    load: async () => {
      const [r] = await rows<{ products: number; history: number }>(
        "SELECT (SELECT COUNT(*) FROM products WHERE active=1) products,(SELECT COUNT(*) FROM stock_transactions WHERE scanned_at>=?) history",
        [since().toISOString().slice(0, 19).replace("T", " ")],
      );
      return [{ updated: new Date(), ...r }];
    },
  } satisfies Feed<Info>,
  riwayat: {
    name: "Riwayat",
    sheet: 1,
    column: 1,
    row: 4,
    columns: historyColumns,
    load: () => backupHistory(since()),
    highlight: highlights.history,
  } satisfies Feed<StockTransaction>,
};
export type FeedKind = keyof typeof feeds;
export const feedKinds = Object.keys(feeds) as FeedKind[];

// ---------- Halaman data (HTML yang dibaca Excel) ----------
const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replace(/\r?\n/g, " · ");
/** Nomor seri Excel dari nilai tanggal (jam dinding zona aplikasi). */
const serial = (d: Date) => d.getTime() / 86400000 + 25569;
/**
 * Sel HTML yang dibaca Excel apa adanya di PC mana pun: angka & tanggal lewat atribut
 * x:num (tidak tergantung pemisah desimal Windows), teks dikunci "@" sehingga kode
 * barang 00123 atau 1E5 tidak berubah menjadi angka.
 */
function htmlCell(kind: ColumnKind, raw: unknown) {
  const v = cellValue(kind, raw);
  if (v === null || v === undefined) return "<td></td>";
  if (v instanceof Date) return `<td x:num="${serial(v)}">${serial(v)}</td>`;
  if (typeof v === "number") return `<td x:num="${v}">${v}</td>`;
  return `<td style="mso-number-format:'\\@'">${esc(String(v))}</td>`;
}
function htmlPage(body: string) {
  return `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><meta name="robots" content="noindex"></head><body>${body}</body></html>`;
}
export function feedTable<T>(columns: Column<T>[], items: T[]) {
  const head = columns.map((c) => `<th>${esc(c.header)}</th>`).join("");
  const body = items
    .map(
      (r) =>
        `<tr>${columns.map((c) => htmlCell(c.kind, c.value(r))).join("")}</tr>`,
    )
    .join("");
  return htmlPage(`<table><tr>${head}</tr>${body}</table>`);
}
export async function feedHtml(kind: FeedKind) {
  const feed = feeds[kind] as Feed<unknown>;
  return feedTable(feed.columns, await feed.load());
}
/** Kunci dicabut: tampil sebagai satu sel pesan di Excel, bukan pesan error berulang. */
export const revokedHtml = htmlPage(
  `<table><tr><th>Akses Excel live sudah dicabut. Unduh ulang file dari web: Pengaturan → Unduh Excel live.</th></tr></table>`,
);

// ---------- Workbook ----------
const xmlAttr = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const colLetter = (n: number) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const SHEETS = ["Stok Barang", "Riwayat Transaksi"];
function writeFeed<T>(ws: ExcelJS.Worksheet, feed: Feed<T>, items: T[]) {
  const header = ws.getRow(feed.row);
  feed.columns.forEach((c, i) => {
    const col = ws.getColumn(feed.column + i);
    if (feed.name !== "Info") {
      // Format per kolom utuh: baris baru hasil refresh ikut terformat.
      col.width = c.width;
      col.numFmt = xlFormat[c.kind];
      col.font = c.kind === "code" ? codeFont : bodyFont;
    } else col.width = Math.max(col.width ?? 0, c.width);
    header.getCell(feed.column + i).value = c.header;
  });
  styleHeader(header);
  items.forEach((item, r) => {
    const row = ws.getRow(feed.row + 1 + r);
    feed.columns.forEach((c, i) => {
      const cell = row.getCell(feed.column + i);
      cell.value = cellValue(c.kind, c.value(item));
      cell.numFmt = xlFormat[c.kind];
    });
  });
  if (feed.highlight) {
    const letter = colLetter(
      feed.column +
        feed.columns.findIndex((c) => c.header === feed.highlight!.column),
    );
    ws.addConditionalFormatting({
      ref: `${letter}${feed.row + 1}:${letter}1048576`,
      rules: feed.highlight.rules.map(([text, fill, font], i) => ({
        type: "cellIs",
        operator: "equal",
        priority: i + 1,
        formulae: [`"${text}"`],
        style: {
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: fill } },
          font: { bold: true, color: { argb: font } },
        },
      })),
    });
  }
  const lastCol = colLetter(feed.column + feed.columns.length - 1);
  const lastRow = feed.row + Math.max(items.length, 1);
  return `'${SHEETS[feed.sheet]}'!$${colLetter(feed.column)}$${feed.row}:$${lastCol}$${lastRow}`;
}
/**
 * Workbook berisi data saat ini + koneksi web per tabel (refresh saat dibuka & tiap
 * `interval` menit). exceljs tidak mendukung koneksi, jadi bagian koneksi ditambahkan
 * langsung ke paket .xlsx dengan struktur yang sama seperti buatan Excel.
 */
export async function buildFeedWorkbook(
  baseUrl: string,
  token: string,
  { interval = 1 } = {},
) {
  const wb = newWorkbook();
  const [stock, history] = SHEETS.map((name, i) =>
    wb.addWorksheet(
      name,
      i === 0 ? { properties: { tabColor: { argb: colors.brand } } } : {},
    ),
  );
  const title = (
    ws: ExcelJS.Worksheet,
    text: string,
    note: string,
    noteCell: string,
  ) => {
    ws.getCell("A1").value = text;
    ws.getCell("A1").font = {
      name: "Calibri",
      size: 15,
      bold: true,
      color: { argb: colors.title },
    };
    ws.getCell(noteCell).value = note;
    ws.getCell(noteCell).font = {
      name: "Calibri",
      size: 10,
      italic: true,
      color: { argb: colors.subtle },
    };
  };
  const note = `Diambil langsung dari web setiap ${interval} menit dan saat file dibuka. Pertama kali di PC ini: klik Enable Editing lalu Enable Content. Jangan diedit — perubahan di file ini tidak masuk ke web.`;
  title(stock, "STOK BARANG GUDANG (LIVE)", note, "F1");
  title(history, "RIWAYAT TRANSAKSI (LIVE)", note, "A2");
  const loaded = await Promise.all(
    feedKinds.map((k) => (feeds[k] as Feed<unknown>).load()),
  );
  const ranges = feedKinds.map((k, i) =>
    writeFeed(
      [stock, history][feeds[k].sheet],
      feeds[k] as Feed<unknown>,
      loaded[i],
    ),
  );
  stock.views = [
    {
      state: "frozen",
      xSplit: 3,
      ySplit: feeds.stok.row,
      showGridLines: false,
    },
  ];
  history.views = [
    {
      state: "frozen",
      xSplit: 1,
      ySplit: feeds.riwayat.row,
      showGridLines: false,
    },
  ];
  for (const ws of [stock, history])
    ws.pageSetup = {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };

  const zip = await JSZip.loadAsync(await toBuffer(wb));
  const read = async (path: string) =>
    (await zip.file(path)?.async("string")) ?? null;
  const connections = feedKinds
    .map((k, i) => {
      const url = `${baseUrl}/api/excel-feed/${k}?key=${token}`;
      return `<connection id="${i + 1}" name="${feeds[k].name}" type="4" refreshedVersion="8" background="1" refreshOnLoad="1" interval="${interval}" saveData="1"><webPr parsePre="1" textDates="1" xl2000="1" url="${xmlAttr(url)}"/></connection>`;
    })
    .join("");
  zip.file(
    "xl/connections.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${connections}</connections>`,
  );
  const sheetRels = new Map<number, string[]>();
  feedKinds.forEach((k, i) => {
    zip.file(
      `xl/queryTables/queryTable${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<queryTable xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="${feeds[k].name}" refreshOnLoad="1" adjustColumnWidth="0" connectionId="${i + 1}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0"/>`,
    );
    const list = sheetRels.get(feeds[k].sheet) ?? [];
    list.push(
      `<Relationship Id="rIdQuery${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" Target="../queryTables/queryTable${i + 1}.xml"/>`,
    );
    sheetRels.set(feeds[k].sheet, list);
  });
  for (const [sheet, rels] of sheetRels) {
    const path = `xl/worksheets/_rels/sheet${sheet + 1}.xml.rels`;
    const existing = await read(path);
    zip.file(
      path,
      existing
        ? existing.replace(
            "</Relationships>",
            rels.join("") + "</Relationships>",
          )
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`,
    );
  }
  const wbRels = (await read("xl/_rels/workbook.xml.rels"))!;
  zip.file(
    "xl/_rels/workbook.xml.rels",
    wbRels.replace(
      "</Relationships>",
      `<Relationship Id="rIdConnections" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/></Relationships>`,
    ),
  );
  const types = (await read("[Content_Types].xml"))!;
  zip.file(
    "[Content_Types].xml",
    types.replace(
      "</Types>",
      `<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/>` +
        feedKinds
          .map(
            (_, i) =>
              `<Override PartName="/xl/queryTables/queryTable${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/>`,
          )
          .join("") +
        "</Types>",
    ),
  );
  // Nama rentang tiap tabel (dipakai Excel untuk menaruh hasil refresh).
  const names = feedKinds
    .map(
      (k, i) =>
        `<definedName name="${feeds[k].name}" localSheetId="${feeds[k].sheet}">${xmlAttr(ranges[i])}</definedName>`,
    )
    .join("");
  let workbook = (await read("xl/workbook.xml"))!;
  workbook = workbook.includes("<definedNames>")
    ? workbook.replace("</definedNames>", names + "</definedNames>")
    : workbook.replace(
        "</sheets>",
        `</sheets><definedNames>${names}</definedNames>`,
      );
  zip.file("xl/workbook.xml", workbook);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
