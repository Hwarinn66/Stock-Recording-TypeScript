import { locationCode } from "../src/services/locations";
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowsDecimal, calculateStock, correction, stockLabel } from "../src/lib/stock";
import { quantitySchema, scanSchema, productSchema } from "../src/validators";
import { dateBoundary, csv } from "../src/services/reports";
test("IN and OUT arithmetic; stock never negative", () => {
  assert.equal(calculateStock(15, 10, "IN"), 25);
  assert.equal(calculateStock(25, 5, "OUT"), 20);
  assert.throws(() => calculateStock(3, 5, "OUT"), {
    code: "STOCK_NOT_ENOUGH",
  });
});
test("quantity validates positive bounded amounts", () => {
  for (const n of [0, -5, 1.0001, 2147483648, NaN]) {
    assert.equal(quantitySchema.safeParse(n).success, false);
    assert.throws(() => calculateStock(10, n, "IN", "Kg"));
  }
  assert.equal(quantitySchema.safeParse("2").success, false);
  assert.throws(() => calculateStock(2147483647, 1, "IN"));
});

test("only Kg items may use decimals (max 3), without rounding", () => {
  assert.equal(allowsDecimal("Kg"), true);
  assert.equal(allowsDecimal("K g"), true);
  assert.equal(allowsDecimal("Pcs"), false);
  assert.throws(() => calculateStock(10, 1.5, "OUT", "Pcs"), { code: "INVALID_QUANTITY" });
  assert.equal(calculateStock(548.8, 0.3, "OUT", "Kg"), 548.5);
  assert.equal(calculateStock(0.1, 0.2, "IN", "Kg"), 0.3);
  assert.equal(calculateStock(1159.53, 1159.53, "OUT", "Kg"), 0);
  assert.throws(() => calculateStock(1, 1.5, "OUT", "Kg"), { code: "STOCK_NOT_ENOUGH" });
  assert.equal(quantitySchema.safeParse(2.125).success, true);
});
test("stock correction: user types the actual count, difference is computed", () => {
  assert.deepEqual(correction(10, 8, "Pcs"), { after: 8, delta: -2 });
  assert.deepEqual(correction(10, 12, "Pcs"), { after: 12, delta: 2 });
  assert.deepEqual(correction(10, 0, "Pcs"), { after: 0, delta: -10 });
  assert.deepEqual(correction(548.8, 548.5, "Kg"), { after: 548.5, delta: -0.3 });
  assert.deepEqual(correction(0.1, 0.3, "Kg"), { after: 0.3, delta: 0.2 });
  assert.deepEqual(correction(10, 10, "Pcs"), {
    error: "Jumlah sama dengan stok di web.",
    same: true,
  });
  for (const [actual, unit] of [
    [8.5, "Pcs"],
    [1.0005, "Kg"],
    [-1, "Pcs"],
    [2147483648, "Pcs"],
    [NaN, "Pcs"],
  ] as const)
    assert.ok("error" in correction(10, actual, unit), `${actual} ${unit}`);
});
test("stock flags", () => {
  assert.equal(stockLabel(0), "STOK HABIS");
  assert.equal(stockLabel(calculateStock(5, 3, "OUT")), "STOK MENIPIS");
  assert.equal(stockLabel(3), "AMAN");
});
test("scan requires secure token and explicit mode", () => {
  assert.equal(
    scanSchema.safeParse({ qr_token: "BRG-001", mode: "IN" }).success,
    false,
  );
  assert.equal(
    scanSchema.safeParse({
      qr_token: "550e8400-e29b-41d4-a716-446655440001",
      mode: "IN",
    }).success,
    true,
  );
});
test("product create rejects stock assignment and SVG image", () => {
  const product = {
    sku: "TEST",
    name: "Test",
    category_id: 1,
    unit: "PCS",
    location_id: 1,
  };
  assert.equal(
    productSchema.safeParse({ ...product, stock: 10 }).success,
    false,
  );
  assert.equal(
    productSchema.safeParse({
      ...product,
      image: "data:image/svg+xml;base64,aaa",
    }).success,
    false,
  );
});
test("Indonesian date filters map to UTC boundaries", () => {
  process.env.APP_TIMEZONE = "Asia/Jakarta";
  assert.equal(dateBoundary("2026-09-30"), "2026-09-29 17:00:00");
  assert.equal(dateBoundary("2026-09-30", true), "2026-09-30 17:00:00");
});
test("CSV escapes quotes and spreadsheet formulas", async () => {
  const text = await csv(
    [{ name: '=HYPERLINK("x")' }],
    ["name"],
    "test",
  ).text();
  assert.ok(text.includes("'=HYPERLINK"));
  assert.ok(text.includes('""x""'));
});

test("CSV keeps negative numbers numeric but escapes text starting with minus", async () => {
  const text = await csv(
    [{ quantity: -5, notes: "-hapus" }],
    ["quantity", "notes"],
    "test",
  ).text();
  assert.ok(text.includes('"-5"'));
  assert.ok(text.includes(`"'-hapus"`));
});

test("history sort only accepts known columns", async () => {
  const { listSchema } = await import("../src/validators");
  for (const sort of ["constructor", "__proto__", "toString", "t.id; DROP"])
    assert.equal(listSchema.safeParse({ sort }).success, false);
  assert.equal(listSchema.parse({ sort: "scanned_at" }).sort, "scanned_at");
});

test("mobile record: quantity digits, 7-digit reservation only for OUT", async () => {
  const { recordSchema } = await import("../src/validators");
  const qr_token = "550e8400-e29b-41d4-a716-446655440001";
  const ok = (v: object) => recordSchema.safeParse({ qr_token, ...v }).success;
  assert.equal(ok({ mode: "IN", quantity: 5 }), true);
  assert.equal(ok({ mode: "OUT", quantity: 5, reservation_number: "0012345" }), true);
  assert.equal(ok({ mode: "OUT", quantity: 5 }), false);
  for (const reservation_number of ["123456", "12345678", "12a4567", " 123456"])
    assert.equal(ok({ mode: "OUT", quantity: 5, reservation_number }), false);
  assert.equal(ok({ mode: "IN", quantity: 5, reservation_number: "1234567" }), false);
  // 1.5 lolos schema; aturan bulat untuk satuan selain Kg dicek di service.
  for (const quantity of [0, -1, 1.0005, "5"])
    assert.equal(ok({ mode: "IN", quantity }), false);
  assert.equal(ok({ mode: "IN", quantity: 5, stock: 10 }), false);
});

test("history revision accepts quantity and/or 7-digit reservation only", async () => {
  const { reviseSchema } = await import("../src/validators");
  const ok = (v: object) => reviseSchema.safeParse(v).success;
  assert.equal(ok({ quantity: 3 }), true);
  assert.equal(ok({ reservation_number: "0012345" }), true);
  assert.equal(ok({ quantity: 2.5, reservation_number: "1234567", reason: "salah ketik" }), true);
  assert.equal(ok({}), false, "harus ada yang direvisi");
  assert.equal(ok({ reason: "hanya alasan" }), false);
  assert.equal(ok({ reservation_number: "123456" }), false);
  assert.equal(ok({ quantity: 0 }), false);
  assert.equal(ok({ quantity: 3, stock: 10 }), false, "field lain ditolak");
});

test("ALLOWED_ORIGINS tolerates spaces after commas", async () => {
  const { checkOrigin } = await import("../src/lib/auth");
  process.env.APP_URL = "https://localhost:3000";
  process.env.ALLOWED_ORIGINS = "https://localhost:3000, https://10.0.0.5:3000";
  const request = (origin: string) =>
    new Request("https://localhost:3000/api/scan", {
      method: "POST",
      headers: { origin },
    });
  assert.doesNotThrow(() => checkOrigin(request("https://10.0.0.5:3000")));
  assert.throws(() => checkOrigin(request("https://evil.example")), {
    code: "INVALID_ORIGIN",
  });
});

test("location codes reset position per rack and preserve numbers above 99", () => {
  assert.equal(locationCode("A", 1, 1), "A.01.01");
  assert.equal(locationCode("A", 1, 2), "A.01.02");
  assert.equal(locationCode("A", 2, 1), "A.02.01");
  assert.equal(locationCode("A", 100, 123), "A.100.123");
});

test("manual movement labels validate without automatic defaults", async () => {
  const { productListSchema, listSchema, productSchema, editProductSchema } =
    await import("../src/validators");
  assert.equal(productListSchema.parse({}).sort, "name");
  assert.equal(listSchema.parse({}).sort, "id");
  assert.equal(
    productListSchema.safeParse({ sort: "name; DROP TABLE products" }).success,
    false,
  );
  const data = {
    sku: "a0001",
    name: "Ember 1 kg",
    category_id: 1,
    unit: "PCS",
    location_id: 1,
  };
  assert.equal(productSchema.parse(data).movement_class, undefined);
  assert.equal(
    productSchema.parse({ ...data, movement_class: "FAST" }).movement_class,
    "FAST",
  );
  assert.equal(
    editProductSchema.parse({ movement_class: null }).movement_class,
    null,
  );
  assert.equal(
    editProductSchema.safeParse({ movement_class: "AUTO" }).success,
    false,
  );
  assert.equal(
    editProductSchema.parse({ movement_class: "DEAD" }).movement_class,
    "DEAD",
  );
  assert.equal(productListSchema.parse({ sort: "dead" }).sort, "dead");
});
