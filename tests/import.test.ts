import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeCsv,
  mapLegacyLocation,
  parseCsv,
  parseMovement,
  readProductRows,
  readMinRows,
} from "../src/services/product-import";

const header = "lokasi2,nobar,nabar,ukuran,satuan,category,stock_type,saldoawal,saldoakhir";

test("CSV quoted fields keep commas, doubled quotes and line breaks", () => {
  const rows = parseCsv(
    'a,b,c\r\n"BINDER;CLIPS;3/4""(19mm)","CABLE;2x0,6MM","multi\nline"\n\n',
  );
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ['BINDER;CLIPS;3/4"(19mm)', "CABLE;2x0,6MM", "multi\nline"],
  ]);
});

test("decode strips UTF-8 BOM and falls back to Windows-1252", () => {
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Ø1")]);
  assert.equal(decodeCsv(utf8), "Ø1");
  assert.equal(decodeCsv(new Uint8Array([0xd8, 0x31])), "Ø1");
});

test("movement status maps FAST/SLOW/DEAD", () => {
  assert.equal(parseMovement("FAST MOVING"), "FAST");
  assert.equal(parseMovement(" slow moving "), "SLOW");
  assert.equal(parseMovement("DEAD STOCK"), "DEAD");
  assert.equal(parseMovement(""), null);
});

test("ERP location AREA.rak.tingkat.urutan maps to block/rack/position, code kept", () => {
  assert.deepEqual(mapLegacyLocation("B.06.24.017"), {
    kind: "grid",
    block: "B",
    rack: 6,
    position: 24017,
    code: "B.06.24.017",
  });
  assert.deepEqual(mapLegacyLocation("Ba.01.00.001"), {
    kind: "grid",
    block: "BA",
    rack: 1,
    position: 1,
    code: "Ba.01.00.001",
  });
  assert.deepEqual(mapLegacyLocation("POLE FACTORY"), { kind: "named", code: "POLE FACTORY" });
  assert.equal(mapLegacyLocation(null), null);
});

test("product rows: Kg keeps decimals exactly, other units must be whole", () => {
  const { items, problems } = readProductRows(
    [
      header,
      'A.01.01.001,PB1A00001,"U-RING;Ø1/2"";SEAL",,Pcs,STOCK ITEM,FAST MOVING,17,28',
      "B.05.05.008,CB4A60001,WELDING;ELECTRODE,,K g,STOCK ITEM,FAST MOVING,347.2,548.8",
      "CP.03.00.002,RA5A00002,ZINC;ALLOY,,Kg,STOCK ITEM,DEAD STOCK,1,1159.53",
      "POLE FACTORY,PL3A50008,CONCRETE;STEEL,,Btg,STOCK ITEM,SLOW MOVING,415,0",
      ",,TANPA KODE,,Pcs,,,,5",
      "X.1,ZZ1,NAMA,,Pcs,,,,abc",
      "X.2,ZZ2,NAMA,,Pcs,,,,-3",
      "X.3,ZZ3,NAMA,,Pcs,,,,2.5",
      "X.4,ZZ4,NAMA,,Kg,,,,2.1234",
    ].join("\n"),
    "Sparepart",
  );
  assert.deepEqual(
    items.map(({ sku, unit, stock, movement, legacyLocation, room }) => ({
      sku,
      unit,
      stock,
      movement,
      legacyLocation,
      room,
    })),
    [
      { sku: "PB1A00001", unit: "Pcs", stock: 28, movement: "FAST", legacyLocation: "A.01.01.001", room: "Ruangan 1" },
      { sku: "CB4A60001", unit: "Kg", stock: 548.8, movement: "FAST", legacyLocation: "B.05.05.008", room: "Ruangan 1" },
      { sku: "RA5A00002", unit: "Kg", stock: 1159.53, movement: "DEAD", legacyLocation: "CP.03.00.002", room: "Ruangan 1" },
      { sku: "PL3A50008", unit: "Btg", stock: 0, movement: "SLOW", legacyLocation: "POLE FACTORY", room: "Ruangan 1" },
    ],
  );
  assert.equal(items[0].name, 'U-RING;Ø1/2";SEAL');
  assert.deepEqual(
    problems.map((p) => [p.line, p.reason]),
    [
      [6, "kode barang kosong"],
      [7, "saldo akhir bukan angka"],
      [8, "saldo akhir negatif"],
      [9, "saldo akhir berkoma untuk satuan Pcs (hanya Kg yang boleh berkoma)"],
      [10, "saldo akhir lebih dari 3 angka di belakang koma"],
    ],
  );
});

test("missing required columns is reported clearly", () => {
  assert.throws(() => readProductRows("kode,nama\nA,B", "ATK"), /nobar, nabar, dan saldoakhir/);
});

test("min column becomes the low-stock threshold; min-only reader needs nobar+min", () => {
  const { items, problems } = readProductRows(
    [
      "lokasi2,nobar,nabar,satuan,saldoakhir,min",
      "A.01.01.001,PB1A00001,SEAL,Pcs,28,7",
      "A.01.01.002,PB1A00002,SEAL,Pcs,3,",
      "A.01.01.003,PB1A00003,SEAL,Pcs,3,-1",
    ].join("\n"),
    "Sparepart",
  );
  assert.deepEqual(items.map((i) => [i.sku, i.minStock]), [["PB1A00001", 7], ["PB1A00002", null]]);
  assert.deepEqual(problems.map((p) => [p.line, p.reason]), [[4, "stok minimal negatif"]]);

  const min = readMinRows("nobar,min\nSA1,10\nSA2,\nSA3,x\n,4\nSA5,0");
  assert.deepEqual(min.items.map((i) => [i.sku, i.minStock]), [["SA1", 10], ["SA5", 0]]);
  assert.deepEqual(min.problems.map((p) => p.reason), ["stok minimal kosong", "stok minimal bukan angka", "kode barang kosong"]);
  assert.throws(() => readMinRows("nobar,saldoakhir\nA,1"), /nobar dan min/);
});
