import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { labelPdf, labelSheetPdf, labelsPdf } from "../src/lib/label-pdf";

/** Isi content stream (dikompres Flate) per halaman. */
function contents(pdf: string) {
  return [...pdf.matchAll(/\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)].map((m) => {
    const start = m.index! + m[0].length;
    return inflateSync(Buffer.from(pdf.slice(start, start + Number(m[1])), "latin1")).toString("latin1");
  });
}
const texts = (content: string) => content.match(/\((?:[^()\\]|\\.)*\) Tj/g);

test("QR label is a one-page 35 x 35 mm PDF with only the QR and item code", () => {
  const sku = String.raw`PA3(A)\1`;
  const pdf = labelPdf("3f2a6c1e-8a4b-4c2d-9e1f-0a1b2c3d4e5f", sku).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.match(pdf, /\/MediaBox \[0 0 99\.213 99\.213\]/); // 35 mm
  assert.match(pdf, /\/Count 1 /);
  // Kurung & backslash di-escape; tidak ada teks lain selain kode barang.
  const [content] = contents(pdf);
  assert.deepEqual(texts(content), [String.raw`(PA3\(A\)\\1) Tj`]);
  const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  // Offset objek di tabel xref menunjuk tepat ke "N 0 obj" (stream biner tidak menggeser).
  const offsets = pdf.slice(xref).match(/^\d{10} 00000 n $/gm)!.map((l) => Number(l.slice(0, 10)));
  offsets.forEach((offset, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj`, offset), `objek ${i + 1}`));
});

test("bulk labels: A4 sheet 35 per page or one per page, optional location line, small file", () => {
  const labels = Array.from({ length: 36 }, (_, i) => ({
    qrToken: `3f2a6c1e-8a4b-4c2d-9e1f-0a1b2c3d4e${String(i).padStart(2, "0")}`,
    sku: `CA1A${String(i).padStart(5, "0")}`,
    note: "Blok A - A.01.01",
  }));
  const sheet = labelSheetPdf(labels).toString("latin1");
  assert.match(sheet, /\/Count 2 /);
  assert.match(sheet, /\/MediaBox \[0 0 595\.276 841\.89\]/); // A4
  const [first, second] = contents(sheet);
  assert.equal(texts(first)!.length, 70, "35 kode + 35 baris lokasi");
  assert.deepEqual(texts(second), ["(CA1A00035) Tj", "(Blok A - A.01.01) Tj"]);
  const roll = labelsPdf(labels.slice(0, 2).map(({ note: _, ...l }) => l)).toString("latin1");
  assert.match(roll, /\/Count 2 /);
  assert.deepEqual(contents(roll).map(texts), [["(CA1A00000) Tj"], ["(CA1A00001) Tj"]]);
  // 1 label ± 1 KB setelah kotak QR digabung & dikompres (batas respons Vercel 4,5 MB).
  assert.ok(sheet.length < 36 * 1500, `${sheet.length} byte`);
});
