import { deflateSync } from "node:zlib";
import QRCode from "qrcode";

// Label QR 35 x 35 mm sebagai PDF: QR + kode barang (+ baris kecil opsional, mis. blok).
// PDF dipakai (bukan halaman web) karena browser selalu menambah header/footer
// (tanggal, judul, alamat) saat mencetak halaman web; PDF tercetak apa adanya.
const MM = 72 / 25.4;
export const LABEL_MM = 35;
const QR_TOP_MM = 3; // jarak QR dari tepi atas
const QR_MM = 25;
const TEXT_GAP_MM = 3.2; // jarak bawah QR ke garis dasar teks
const TEXT_MAX_MM = 31;

const num = (n: number) => Number(n.toFixed(3)).toString();
/** Teks PDF: hanya ASCII, karakter khusus di-escape. */
const pdfText = (text: string) =>
  text.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (c) => "\\" + c);

/** note: baris kecil tipis di bawah kode barang (mis. "Blok A"); kosong = tidak ada. */
type Label = { qrToken: string; sku: string; note?: string };

/** Teks rata tengah selebar label; Courier & Courier-Bold: tiap huruf 0,6 em. Dikecilkan bila panjang. */
function centeredText(font: "F1" | "F2", raw: string, maxSize: number, x0: number, baseline: number) {
  const page = LABEL_MM * MM;
  const fontSize = Math.min(maxSize, (TEXT_MAX_MM * MM) / (0.6 * Math.max(raw.length, 1)));
  const width = 0.6 * fontSize * raw.length;
  return `BT /${font} ${num(fontSize)} Tf ${num(x0 + (page - width) / 2)} ${num(baseline)} Td (${pdfText(raw)}) Tj ET`;
}

/** Isi satu label: kotak-kotak QR (vektor) + teks; (x0, y0) = pojok kiri bawah label. */
function labelContent({ qrToken, sku, note }: Label, x0 = 0, y0 = 0) {
  const page = LABEL_MM * MM;
  // Dengan baris tambahan, QR sedikit lebih kecil & lebih ke atas agar teks tidak mepet tepi bawah.
  const qrTop = note ? 2.5 : QR_TOP_MM;
  const qrMm = note ? 23.5 : QR_MM;
  const gap = note ? 3 : TEXT_GAP_MM;
  const qr = QRCode.create(qrToken, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const cell = (qrMm * MM) / size;
  const left = x0 + (page - qrMm * MM) / 2;
  const top = y0 + page - qrTop * MM; // koordinat PDF dihitung dari bawah
  const ops = ["0 g"];
  // Kotak hitam berurutan dalam satu baris digabung menjadi satu persegi panjang
  // (file jauh lebih kecil untuk cetak ratusan label sekaligus).
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) {
      if (!qr.modules.get(row, col)) continue;
      const start = col;
      while (col + 1 < size && qr.modules.get(row, col + 1)) col++;
      ops.push(
        `${num(left + start * cell)} ${num(top - (row + 1) * cell)} ${num((col - start + 1) * cell)} ${num(cell)} re`,
      );
    }
  ops.push("f");
  // Kode barang tebal (Courier-Bold), baris tambahan kecil & tipis (Courier).
  const baseline = top - qrMm * MM - gap * MM;
  ops.push(centeredText("F1", sku, 8, x0, baseline));
  if (note) ops.push(centeredText("F2", note, 5.5, x0, baseline - 2.6 * MM));
  return ops.join("\n");
}

/** PDF dari halaman-halaman (ukuran dalam pt, isi content stream dikompres Flate). */
function buildPdf(pages: { width: number; height: number; content: string }[]) {
  // Objek: 1 katalog, 2 daftar halaman, 3-4 font, lalu tiap halaman: halaman + isinya.
  const pageIds = pages.map((_, i) => 5 + i * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  pages.forEach(({ width, height, content }, i) => {
    const stream = deflateSync(Buffer.from(content, "latin1")).toString("latin1");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
      `<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n${stream}\nendstream`,
    );
  });
  // Berkas disusun sebagai teks latin1 (1 karakter = 1 byte), termasuk stream biner.
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** Label 35 x 35 mm, satu per halaman (untuk printer label). */
export function labelsPdf(labels: Label[]) {
  const size = LABEL_MM * MM;
  return buildPdf(labels.map((l) => ({ width: size, height: size, content: labelContent(l) })));
}

export const labelPdf = (qrToken: string, sku: string) => labelsPdf([{ qrToken, sku }]);

const A4 = { width: 210 * MM, height: 297 * MM };
const SHEET_MARGIN_MM = 10;
export const SHEET_COLUMNS = Math.floor((210 - 2 * SHEET_MARGIN_MM) / LABEL_MM); // 5
export const SHEET_ROWS = Math.floor((297 - 2 * SHEET_MARGIN_MM) / LABEL_MM); // 7

/**
 * Banyak label 35 x 35 mm di kertas A4 (5 x 7 = 35 per halaman), urut kiri→kanan, atas→bawah.
 * Garis potong abu-abu putus-putus di tepi tiap label untuk memudahkan menggunting.
 */
export function labelSheetPdf(labels: Label[]) {
  const cell = LABEL_MM * MM;
  const perPage = SHEET_COLUMNS * SHEET_ROWS;
  const gridLeft = (A4.width - SHEET_COLUMNS * cell) / 2;
  const gridTop = A4.height - SHEET_MARGIN_MM * MM;
  const pages = [];
  for (let start = 0; start < labels.length; start += perPage) {
    const parts = labels.slice(start, start + perPage).map((label, i) => {
      const x = gridLeft + (i % SHEET_COLUMNS) * cell;
      const y = gridTop - (Math.floor(i / SHEET_COLUMNS) + 1) * cell;
      return [
        `0.7 G 0.3 w [2 2] 0 d ${num(x)} ${num(y)} ${num(cell)} ${num(cell)} re S [] 0 d`,
        labelContent(label, x, y),
      ].join("\n");
    });
    pages.push({ ...A4, content: parts.join("\n") });
  }
  return buildPdf(pages);
}
