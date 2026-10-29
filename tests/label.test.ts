import { test } from "node:test";
import assert from "node:assert/strict";
import { labelPdf } from "../src/lib/label-pdf";

test("QR label is a one-page 35 x 35 mm PDF with only the QR and item code", () => {
  const sku = String.raw`PA3(A)\1`;
  const pdf = labelPdf("3f2a6c1e-8a4b-4c2d-9e1f-0a1b2c3d4e5f", sku).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.match(pdf, /\/MediaBox \[0 0 99\.213 99\.213\]/); // 35 mm
  assert.match(pdf, /\/Count 1 /);
  // Kurung & backslash di-escape; tidak ada teks lain selain kode barang.
  const texts = pdf.match(/\((?:[^()\\]|\\.)*\) Tj/g);
  assert.deepEqual(texts, [String.raw`(PA3\(A\)\\1) Tj`]);
  const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref");
});
