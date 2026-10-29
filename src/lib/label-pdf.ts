import QRCode from "qrcode";

// Label QR 35 x 35 mm sebagai PDF: hanya QR + kode barang.
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

export function labelPdf(qrToken: string, sku: string) {
  const page = LABEL_MM * MM;
  const qr = QRCode.create(qrToken, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const cell = (QR_MM * MM) / size;
  const left = (page - QR_MM * MM) / 2;
  const top = page - QR_TOP_MM * MM; // koordinat PDF dihitung dari bawah
  const ops = ["0 g"];
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++)
      if (qr.modules.get(row, col))
        ops.push(
          `${num(left + col * cell)} ${num(top - (row + 1) * cell)} ${num(cell)} ${num(cell)} re`,
        );
  ops.push("f");
  // Courier-Bold: lebar tiap huruf 0,6 em, jadi teks mudah dirata-tengah & dikecilkan bila panjang.
  const text = pdfText(sku);
  const fontSize = Math.min(8, (TEXT_MAX_MM * MM) / (0.6 * Math.max(sku.length, 1)));
  const width = 0.6 * fontSize * sku.length;
  const baseline = top - QR_MM * MM - TEXT_GAP_MM * MM;
  ops.push(
    `BT /F1 ${num(fontSize)} Tf ${num((page - width) / 2)} ${num(baseline)} Td (${text}) Tj ET`,
  );
  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page)} ${num(page)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(pdf);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
