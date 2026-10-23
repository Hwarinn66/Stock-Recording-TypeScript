import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { db } from "../src/lib/db";
import {
  decodeCsv,
  readProductRows,
  importProducts,
  mapLegacyLocation,
  DEFAULT_ROOM,
  HOLDING_ROOM,
  type ImportRow,
} from "../src/services/product-import";

const usage = `Gunakan:
  npm run products:import -- --category=ATK file-atk.csv --category=Sparepart file-part.csv
Opsi: --room="Ruangan 1" (ruangan untuk kode lokasi ERP, default ${DEFAULT_ROOM}).
Tambahkan --apply untuk menyimpan. Tanpa --apply hanya pratinjau (database tidak diubah).`;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const files: { path: string; category: string; room: string }[] = [];
let category = "";
let room = DEFAULT_ROOM;
for (const arg of args) {
  if (arg === "--apply") continue;
  if (arg.startsWith("--category=")) category = arg.slice("--category=".length).trim();
  else if (arg.startsWith("--room=")) room = arg.slice("--room=".length).trim() || DEFAULT_ROOM;
  else if (!category) {
    console.error(`Tentukan --category=... sebelum file ${arg}.\n\n${usage}`);
    process.exit(1);
  } else files.push({ path: arg, category, room });
}
if (!files.length) {
  console.error(usage);
  process.exit(1);
}

try {
  const items: ImportRow[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    const name = basename(file.path);
    const { items: rows, problems } = readProductRows(
      decodeCsv(readFileSync(file.path)),
      file.category,
      file.room,
    );
    console.log(`${name}: ${rows.length} barang dibaca (kategori ${file.category}, ${file.room}).`);
    for (const problem of problems)
      console.log(`  ! baris ${problem.line} ${problem.sku || "-"}: ${problem.reason} → dilewati`);
    for (const row of rows) {
      const key = row.sku.toUpperCase();
      if (seen.has(key)) {
        console.log(`  ! baris ${row.line} ${row.sku}: kode barang dobel (sudah ada di ${seen.get(key)}) → dilewati`);
        continue;
      }
      seen.set(key, `${name} baris ${row.line}`);
      items.push(row);
    }
  }

  const byLocation = new Map<string, string[]>();
  for (const item of items) {
    if (!item.legacyLocation) continue;
    const list = byLocation.get(item.legacyLocation) ?? [];
    list.push(item.sku);
    byLocation.set(item.legacyLocation, list);
  }
  for (const [code, skus] of byLocation)
    if (skus.length > 1)
      console.log(`  ! lokasi ${code} dipakai ${skus.join(", ")} → barang kedua dst. mendapat kode "${code} (2)" dst.`);
  const named = [...new Set(items.map((i) => mapLegacyLocation(i.legacyLocation)).filter((m) => m?.kind === "named").map((m) => m!.code))];
  if (named.length) console.log(`  i kode lokasi non-standar dijadikan ruangan tersendiri: ${named.join(", ")}`);
  const noLocation = items.filter((i) => !i.legacyLocation).length;
  const decimal = items.filter((i) => !Number.isInteger(i.stock));

  const summary = await importProducts(items, apply);
  console.log(`\n${apply ? "HASIL IMPOR" : "PRATINJAU (belum disimpan)"}`);
  console.log(`  Barang baru            : ${summary.created}`);
  console.log(`  Barang diperbarui      : ${summary.updated}`);
  console.log(`    - lokasi berubah     : ${summary.locationChanges}`);
  console.log(`    - label berubah      : ${summary.movementChanges}`);
  console.log(`    - stok berubah       : ${summary.stockChanges.length}`);
  for (const item of summary.stockChanges.slice(0, 30))
    console.log(`        ${item.sku}  ${item.from} → ${item.to}`);
  if (summary.stockChanges.length > 30) console.log(`        … dan ${summary.stockChanges.length - 30} lainnya`);
  console.log(`  Tidak berubah          : ${summary.unchanged}`);
  console.log(`  Dilewati               : ${summary.skipped.length}`);
  for (const item of summary.skipped) console.log(`    ${item.sku}: ${item.reason}`);
  for (const item of summary.sharedLocations)
    console.log(`  Lokasi dipakai bersama : ${item.sku} → ${item.code}`);
  if (decimal.length)
    console.log(`  Stok berkoma (Kg, tanpa pembulatan): ${decimal.map((i) => `${i.sku}=${i.stock}`).join(", ")}`);
  if (noLocation) console.log(`  Tanpa kode lokasi      : ${noLocation} → ruangan "${HOLDING_ROOM}"`);
  if (!apply) console.log("\nJalankan ulang dengan --apply untuk menyimpan.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.end();
}
