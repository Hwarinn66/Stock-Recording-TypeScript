import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { rows, execute, transaction, publish } from "@/lib/db";
import { allowsDecimal, DEFAULT_MIN_STOCK, MAX_QUANTITY, roundStock, validAmount } from "@/lib/stock";
import { locationCode } from "./locations";

// Impor master barang dari ekspor ERP (CSV): kode (nobar), nama (nabar), satuan,
// sisa stok (saldoakhir), batas stok minimal (min), label pergerakan (stock_type)
// dan lokasi (lokasi2).
// Tanpa histori transaksi.
export const HOLDING_ROOM = "Belum Ditempatkan";
export const HOLDING_BLOCK = "X";
export const DEFAULT_ROOM = "Ruangan 1";
// Posisi cadangan bila satu kode lokasi ERP dipakai lebih dari satu barang.
const OVERFLOW_START = 900000;

export type Movement = "FAST" | "SLOW" | "DEAD" | null;

export type ImportRow = {
  line: number;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  sourceStock: string;
  /** Kolom min: batas STOK MENIPIS; null = kolom kosong/tidak ada (nilai lama dipakai). */
  minStock: number | null;
  movement: Movement;
  legacyLocation: string | null;
  category: string;
  room: string;
};

export type ImportProblem = { line: number; sku: string; reason: string };

export type ImportSummary = {
  created: number;
  updated: number;
  stockChanges: { sku: string; from: number; to: number }[];
  movementChanges: number;
  locationChanges: number;
  unchanged: number;
  skipped: { sku: string; reason: string }[];
  sharedLocations: { sku: string; code: string }[];
};

/** UTF-8 bila valid; ekspor Excel lama sering memakai Windows-1252 (mis. "Ø"). */
export function decodeCsv(buffer: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(buffer)
      .replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/** CSV RFC 4180: field berkutip boleh berisi koma, baris baru, dan "" untuk kutip. */
export function parseCsv(text: string) {
  const result: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      result.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    result.push(row);
  }
  return result.filter((cells) => cells.some((cell) => cell.trim()));
}

/** Isi kolom min: angka >= 0 (maks. 3 desimal) → angka; kosong → null; salah → alasan. */
export function parseMinStock(value: string): number | null | string {
  if (value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "stok minimal bukan angka";
  if (amount < 0) return "stok minimal negatif";
  if (amount > MAX_QUANTITY) return "stok minimal terlalu besar";
  if (!validAmount(amount, "Kg")) return "stok minimal lebih dari 3 angka di belakang koma";
  return roundStock(amount);
}

/** FAST MOVING → FAST, SLOW MOVING → SLOW, DEAD STOCK → DEAD; lainnya tanpa label. */
export function parseMovement(value: string): Movement {
  const text = value.trim().toUpperCase();
  return text.startsWith("FAST")
    ? "FAST"
    : text.startsWith("SLOW")
      ? "SLOW"
      : text.startsWith("DEAD")
        ? "DEAD"
        : null;
}

export type MappedLocation =
  | { kind: "grid"; block: string; rack: number; position: number; code: string }
  | { kind: "named"; code: string };

/**
 * Kode ERP AREA.rak.tingkat.urutan (mis. B.06.24.017) → Blok B, Rak 06,
 * nomor posisi tingkat×1000+urutan (24017). Kode tampil apa adanya.
 * Kode lain (mis. "POLE FACTORY") menjadi ruangan tersendiri.
 */
export function mapLegacyLocation(code: string | null): MappedLocation | null {
  if (!code) return null;
  const match = /^([A-Za-z]{1,20})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(code);
  if (match && Number(match[2]) > 0) {
    const position = Number(match[3]) * 1000 + Number(match[4]);
    if (position > 0)
      return {
        kind: "grid",
        block: match[1].toUpperCase(),
        rack: Number(match[2]),
        position,
        code,
      };
  }
  return { kind: "named", code: code.slice(0, 50) };
}

export function readProductRows(text: string, category: string, room = DEFAULT_ROOM) {
  const [header = [], ...data] = parseCsv(text);
  const column = (name: string) =>
    header.findIndex((cell) => cell.trim().toLowerCase() === name);
  const sku = column("nobar");
  const name = column("nabar");
  const stock = column("saldoakhir");
  const unit = column("satuan");
  const place = column("lokasi2");
  const movement = column("stock_type");
  const min = column("min");
  if (sku < 0 || name < 0 || stock < 0)
    throw new Error("Kolom wajib nobar, nabar, dan saldoakhir tidak ditemukan.");

  const items: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  data.forEach((cells, index) => {
    const line = index + 2;
    const value = (i: number) => (i < 0 ? "" : (cells[i] ?? "").trim());
    const row = {
      line,
      sku: value(sku),
      name: value(name),
      // "K g" pada ekspor ERP → "Kg".
      unit: value(unit).replace(/\s+/g, "") || "Pcs",
      sourceStock: value(stock),
      movement: parseMovement(value(movement)),
      legacyLocation: value(place) || null,
      category,
      room,
    };
    const amount = Number(row.sourceStock);
    const minStock = parseMinStock(value(min));
    const reason = typeof minStock === "string"
      ? minStock
      : !row.sku
      ? "kode barang kosong"
      : row.sku.length > 64
        ? "kode barang lebih dari 64 karakter"
        : !row.name
          ? "nama barang kosong"
          : row.name.length > 255
            ? "nama barang lebih dari 255 karakter"
            : row.unit.length > 20
              ? "satuan lebih dari 20 karakter"
              : row.sourceStock === "" || !Number.isFinite(amount)
                ? "saldo akhir bukan angka"
                : amount < 0
                  ? "saldo akhir negatif"
                  : amount > MAX_QUANTITY
                    ? "saldo akhir terlalu besar"
                    : !validAmount(amount, row.unit)
                      ? allowsDecimal(row.unit)
                        ? "saldo akhir lebih dari 3 angka di belakang koma"
                        : `saldo akhir berkoma untuk satuan ${row.unit} (hanya Kg yang boleh berkoma)`
                      : null;
    if (reason) problems.push({ line, sku: row.sku, reason });
    // Tanpa pembulatan: roundStock hanya merapikan galat floating point.
    else items.push({ ...row, stock: roundStock(amount), minStock: minStock as number | null });
  });
  return { items, problems };
}

export type MinRow = { line: number; sku: string; minStock: number };

/** Hanya kode barang (nobar) + batas minimal (min); kolom lain diabaikan. */
export function readMinRows(text: string) {
  const [header = [], ...data] = parseCsv(text);
  const column = (name: string) =>
    header.findIndex((cell) => cell.trim().toLowerCase() === name);
  const sku = column("nobar");
  const min = column("min");
  if (sku < 0 || min < 0) throw new Error("Kolom wajib nobar dan min tidak ditemukan.");
  const items: MinRow[] = [];
  const problems: ImportProblem[] = [];
  data.forEach((cells, index) => {
    const line = index + 2;
    const code = (cells[sku] ?? "").trim();
    const minStock = parseMinStock((cells[min] ?? "").trim());
    if (!code) problems.push({ line, sku: code, reason: "kode barang kosong" });
    else if (minStock === null) problems.push({ line, sku: code, reason: "stok minimal kosong" });
    else if (typeof minStock === "string") problems.push({ line, sku: code, reason: minStock });
    else items.push({ line, sku: code, minStock });
  });
  return { items, problems };
}

export type MinSummary = {
  updated: { sku: string; from: number; to: number }[];
  unchanged: number;
  notFound: string[];
};

/**
 * Isi batas stok minimal saja (stok, nama, lokasi tidak disentuh), dicocokkan dengan kode barang.
 * apply=false = pratinjau. Barang dengan transaksi pending tetap boleh (stok tidak berubah).
 */
export async function importMinStock(items: MinRow[], apply: boolean) {
  const run = async (conn?: PoolConnection): Promise<MinSummary> => {
    const summary: MinSummary = { updated: [], unchanged: 0, notFound: [] };
    const found = new Map<string, { id: number; min_stock: number }>();
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500).map((item) => item.sku);
      const list = await rows<{ id: number; sku: string; min_stock: number }>(
        `SELECT id,sku,min_stock FROM products WHERE sku IN (${chunk.map(() => "?").join(",")})${conn ? " FOR UPDATE" : ""}`,
        chunk,
        conn,
      );
      for (const p of list) found.set(p.sku.toUpperCase(), p);
    }
    for (const item of items) {
      const product = found.get(item.sku.toUpperCase());
      if (!product) summary.notFound.push(item.sku);
      else if (product.min_stock === item.minStock) summary.unchanged++;
      else {
        summary.updated.push({ sku: item.sku, from: product.min_stock, to: item.minStock });
        if (conn) await execute("UPDATE products SET min_stock=? WHERE id=?", [item.minStock, product.id], conn);
      }
    }
    if (conn && summary.updated.length) await publish(conn, "product");
    return summary;
  };
  return apply ? transaction(run) : run();
}

type Existing = {
  id: number;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  min_stock: number;
  movement_class: Movement;
  location_code: string;
  room_name: string;
  pending: number;
};

async function existingProducts(skus: string[], conn?: PoolConnection) {
  const found = new Map<string, Existing>();
  for (let i = 0; i < skus.length; i += 500) {
    const chunk = skus.slice(i, i + 500);
    const list = await rows<Existing>(
      `SELECT p.id,p.sku,p.name,p.unit,p.stock,p.min_stock,p.movement_class,l.code location_code,rm.name room_name,(SELECT COUNT(*) FROM stock_transactions t WHERE t.product_id=p.id AND t.status='PENDING') pending FROM products p JOIN locations l ON l.id=p.location_id JOIN racks r ON r.id=l.rack_id JOIN blocks b ON b.id=r.block_id JOIN rooms rm ON rm.id=b.room_id WHERE p.sku IN (${chunk.map(() => "?").join(",")})${conn ? " FOR UPDATE" : ""}`,
      chunk,
      conn,
    );
    for (const item of list) found.set(item.sku.toUpperCase(), item);
  }
  return found;
}

type Target = { room: string; code: string; mapped: MappedLocation };

function targetOf(item: ImportRow): Target | null {
  const mapped = mapLegacyLocation(item.legacyLocation);
  if (!mapped) return null;
  return {
    room: mapped.kind === "grid" ? item.room : mapped.code,
    code: mapped.code,
    mapped,
  };
}

/** Termasuk posisi cadangan "KODE (2)" untuk kode yang dipakai bersama. */
function atTarget(current: Existing, target: Target) {
  return (
    current.room_name === target.room &&
    (current.location_code === target.code ||
      current.location_code.startsWith(`${target.code} (`))
  );
}

async function findOrCreate(
  select: string,
  insert: string,
  params: unknown[],
  insertParams: unknown[],
  conn: PoolConnection,
) {
  const [row] = await rows<{ id: number }>(select, params, conn);
  return row ? row.id : (await execute(insert, insertParams, conn)).insertId;
}

class Locator {
  private ids = new Map<string, number>();
  private holding = new Map<string, { id: number; number: number; last: number }>();
  private shared = new Map<string, number>();
  constructor(private conn: PoolConnection) {}

  private async cached(key: string, create: () => Promise<number>) {
    let id = this.ids.get(key);
    if (id === undefined) {
      id = await create();
      this.ids.set(key, id);
    }
    return id;
  }

  room(name: string) {
    return this.cached(`room:${name}`, () =>
      findOrCreate(
        "SELECT id FROM rooms WHERE name=?",
        "INSERT INTO rooms(name) VALUES (?)",
        [name],
        [name],
        this.conn,
      ),
    );
  }

  async block(room: string, code: string, name: string) {
    const roomId = await this.room(room);
    return this.cached(`block:${room}:${code}`, () =>
      findOrCreate(
        "SELECT id FROM blocks WHERE room_id=? AND code=?",
        "INSERT INTO blocks(room_id,code,name) VALUES (?,?,?)",
        [roomId, code],
        [roomId, code, name],
        this.conn,
      ),
    );
  }

  async rack(room: string, block: string, number: number, blockName: string, rackName: string) {
    const blockId = await this.block(room, block, blockName);
    return this.cached(`rack:${room}:${block}:${number}`, () =>
      findOrCreate(
        "SELECT id FROM racks WHERE block_id=? AND rack_number=?",
        "INSERT INTO racks(block_id,rack_number,name) VALUES (?,?,?)",
        [blockId, number],
        [blockId, number, rackName],
        this.conn,
      ),
    );
  }

  private async create(rack: number, position: number, code: string, name: string, legacy: string | null) {
    return (
      await execute(
        "INSERT INTO locations(rack_id,position_number,code,name,legacy_code,active) VALUES (?,?,?,?,?,1)",
        [rack, position, code.slice(0, 50), name.slice(0, 100), legacy?.slice(0, 50) ?? null],
        this.conn,
      )
    ).insertId;
  }

  /** Lokasi sesuai kode ERP; bila sudah ditempati barang lain → posisi cadangan. */
  async target(target: Target, productId: number) {
    const { mapped } = target;
    const rack =
      mapped.kind === "grid"
        ? await this.rack(
            target.room,
            mapped.block,
            mapped.rack,
            `Blok ${mapped.block}`,
            `Rak ${mapped.block}.${String(mapped.rack).padStart(2, "0")}`,
          )
        : await this.rack(target.room, HOLDING_BLOCK, 1, "Area", "Rak 1");
    const position = mapped.kind === "grid" ? mapped.position : 1;
    const [location] = await rows<{ id: number; active: number }>(
      "SELECT id,active FROM locations WHERE rack_id=? AND position_number=? FOR UPDATE",
      [rack, position],
      this.conn,
    );
    if (!location)
      return { id: await this.create(rack, position, target.code, `Posisi ${target.code}`, target.code), shared: null };
    const [occupant] = await rows(
      "SELECT id FROM products WHERE location_id=? AND active=1 AND id<>?",
      [location.id, productId],
      this.conn,
    );
    if (!occupant) {
      if (!location.active)
        await execute("UPDATE locations SET active=1 WHERE id=?", [location.id], this.conn);
      return { id: location.id, shared: null };
    }
    const key = `${target.room}:${target.code}`;
    const copy = (this.shared.get(key) ?? 1) + 1;
    this.shared.set(key, copy);
    const [{ next }] = await rows<{ next: number }>(
      "SELECT COALESCE(MAX(position_number),?)+1 next FROM locations WHERE rack_id=? AND position_number>=?",
      [OVERFLOW_START - 1, rack, OVERFLOW_START],
      this.conn,
    );
    const code = `${target.code} (${copy})`;
    return { id: await this.create(rack, next, code, `Posisi ${code}`, target.code), shared: code };
  }

  /** Barang tanpa kode lokasi: area "Belum Ditempatkan", satu rak per kategori. */
  async holdingSlot(category: string) {
    let rack = this.holding.get(category);
    if (!rack) {
      const blockId = await this.block(HOLDING_ROOM, HOLDING_BLOCK, "Belum ditempatkan");
      const rackName = `Impor ${category}`.slice(0, 100);
      let [found] = await rows<{ id: number; rack_number: number }>(
        "SELECT id,rack_number FROM racks WHERE block_id=? AND name=?",
        [blockId, rackName],
        this.conn,
      );
      if (!found) {
        const [{ next }] = await rows<{ next: number }>(
          "SELECT COALESCE(MAX(rack_number),0)+1 next FROM racks WHERE block_id=?",
          [blockId],
          this.conn,
        );
        found = {
          id: (await execute("INSERT INTO racks(block_id,rack_number,name) VALUES (?,?,?)", [blockId, next, rackName], this.conn)).insertId,
          rack_number: next,
        };
      }
      const [{ last }] = await rows<{ last: number }>(
        "SELECT COALESCE(MAX(position_number),0) last FROM locations WHERE rack_id=?",
        [found.id],
        this.conn,
      );
      rack = { id: found.id, number: found.rack_number, last };
      this.holding.set(category, rack);
    }
    const position = ++rack.last;
    return this.create(rack.id, position, locationCode(HOLDING_BLOCK, rack.number, position), `Posisi ${position}`, null);
  }

  /** Hapus sisa area "Belum Ditempatkan" yang kosong dan tanpa histori. */
  async cleanupHolding() {
    await execute(
      "DELETE l FROM locations l JOIN racks r ON r.id=l.rack_id JOIN blocks b ON b.id=r.block_id JOIN rooms rm ON rm.id=b.room_id WHERE rm.name=? AND NOT EXISTS (SELECT 1 FROM products p WHERE p.location_id=l.id) AND NOT EXISTS (SELECT 1 FROM stock_transactions t WHERE t.location_id=l.id)",
      [HOLDING_ROOM],
      this.conn,
    );
    await execute(
      "DELETE r FROM racks r JOIN blocks b ON b.id=r.block_id JOIN rooms rm ON rm.id=b.room_id WHERE rm.name=? AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.rack_id=r.id)",
      [HOLDING_ROOM],
      this.conn,
    );
    await execute(
      "DELETE b FROM blocks b JOIN rooms rm ON rm.id=b.room_id WHERE rm.name=? AND NOT EXISTS (SELECT 1 FROM racks r WHERE r.block_id=b.id)",
      [HOLDING_ROOM],
      this.conn,
    );
    await execute(
      "DELETE FROM rooms WHERE name=? AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.room_id=rooms.id)",
      [HOLDING_ROOM],
      this.conn,
    );
  }
}

/**
 * apply=false hanya membaca database (pratinjau). apply=true menulis semuanya
 * dalam satu SQL transaction: gagal di mana pun → tidak ada yang tersimpan.
 * Kode barang yang sudah ada diperbarui nama, satuan, stok, label pergerakan
 * dan lokasinya; kategori tidak diubah. Barang dengan transaksi pending dilewati.
 */
export async function importProducts(items: ImportRow[], apply: boolean) {
  const run = async (conn?: PoolConnection): Promise<ImportSummary> => {
    const current = await existingProducts(items.map((item) => item.sku), conn);
    const locator = conn ? new Locator(conn) : null;
    const categories = new Map<string, number>();
    const summary: ImportSummary = {
      created: 0,
      updated: 0,
      stockChanges: [],
      movementChanges: 0,
      locationChanges: 0,
      unchanged: 0,
      skipped: [],
      sharedLocations: [],
    };
    for (const item of items) {
      const found = current.get(item.sku.toUpperCase());
      const target = targetOf(item);
      if (found) {
        if (found.pending) {
          summary.skipped.push({ sku: item.sku, reason: "masih ada transaksi pending" });
          continue;
        }
        const move = target !== null && !atTarget(found, target);
        const stockChanged = found.stock !== item.stock;
        const movementChanged = found.movement_class !== item.movement;
        const minStock = item.minStock ?? found.min_stock;
        if (!move && !stockChanged && !movementChanged && minStock === found.min_stock && found.name === item.name && found.unit === item.unit) {
          summary.unchanged++;
          continue;
        }
        summary.updated++;
        if (stockChanged) summary.stockChanges.push({ sku: item.sku, from: found.stock, to: item.stock });
        if (movementChanged) summary.movementChanges++;
        if (move) summary.locationChanges++;
        if (!locator || !conn) continue;
        let locationId: number | null = null;
        if (move) {
          const slot = await locator.target(target, found.id);
          if (slot.shared) summary.sharedLocations.push({ sku: item.sku, code: slot.shared });
          locationId = slot.id;
        }
        await execute(
          `UPDATE products SET name=?,unit=?,stock=?,min_stock=?,movement_class=?${locationId ? ",location_id=?" : ""} WHERE id=?`,
          [item.name, item.unit, item.stock, minStock, item.movement, ...(locationId ? [locationId] : []), found.id],
          conn,
        );
        continue;
      }
      summary.created++;
      if (!locator || !conn) continue;
      let category = categories.get(item.category);
      if (category === undefined) {
        category = await findOrCreate(
          "SELECT id FROM categories WHERE name=?",
          "INSERT INTO categories(name) VALUES (?)",
          [item.category],
          [item.category],
          conn,
        );
        categories.set(item.category, category);
      }
      let locationId: number;
      if (target) {
        const slot = await locator.target(target, 0);
        if (slot.shared) summary.sharedLocations.push({ sku: item.sku, code: slot.shared });
        locationId = slot.id;
      } else locationId = await locator.holdingSlot(item.category);
      await execute(
        "INSERT INTO products(sku,name,category_id,unit,stock,min_stock,movement_class,location_id,qr_token) VALUES (?,?,?,?,?,?,?,?,?)",
        [item.sku, item.name, category, item.unit, item.stock, item.minStock ?? DEFAULT_MIN_STOCK, item.movement, locationId, randomUUID()],
        conn,
      );
    }
    if (locator && conn) {
      await locator.cleanupHolding();
      if (summary.created || summary.updated) await publish(conn, "import");
    }
    return summary;
  };
  return apply ? transaction(run) : run();
}
