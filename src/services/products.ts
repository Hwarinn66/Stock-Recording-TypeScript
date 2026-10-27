import {
  hierarchyJoins,
  hierarchyFields,
  locationCode,
} from "./locations";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rows, execute, transaction, publish } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { productSchema, editProductSchema } from "@/validators";
import type { Product } from "@/types";
import { lockProduct, ensureUnlocked, productColumns } from "./transactions";
import type { PoolConnection } from "mysql2/promise";

const productExtras = `c.name category_name,l.code location_code,${hierarchyFields}`;
const productJoins = ` FROM products p JOIN categories c ON c.id=p.category_id JOIN locations l ON l.id=p.location_id ${hierarchyJoins}`;
export const productSelect = `SELECT ${productColumns},${productExtras}${productJoins}`;
export const productListSelect = productSelect;

export async function getProduct(id: number) {
  const [p] = await rows<Product>(productSelect + " WHERE p.id=?", [id]);
  if (!p) throw new AppError("NOT_FOUND", "Barang tidak ditemukan.", 404);
  return p;
}

async function checkLocation(
  locationId: number,
  productId: number,
  conn: PoolConnection,
) {
  const [location] = await rows<{ code: string; active: number }>(
    "SELECT * FROM locations WHERE id=? FOR UPDATE",
    [locationId],
    conn,
  );
  if (!location || !location.active)
    throw new AppError(
      "INVALID_LOCATION",
      "Posisi tidak ditemukan atau tidak aktif.",
    );

  const [occupied] = await rows<{ name: string }>(
    "SELECT name FROM products WHERE location_id=? AND active=1 AND id<>?",
    [locationId, productId],
    conn,
  );
  if (occupied)
    throw new AppError(
      "LOCATION_IN_USE",
      `Posisi ${location.code} sudah digunakan oleh ${occupied.name}. Silakan pilih posisi lain.`,
      409,
    );
}

type PositionInput = {
  location_id?: number;
  rack_id?: number;
  position_number?: number;
};

async function resolveLocation(
  input: PositionInput,
  productId: number,
  conn: PoolConnection,
) {
  if (input.rack_id !== undefined && input.position_number !== undefined) {
    const [rack] = await rows<{
      id: number;
      rack_number: number;
      block_code: string;
    }>(
      "SELECT r.id,r.rack_number,b.code block_code FROM racks r JOIN blocks b ON b.id=r.block_id WHERE r.id=? FOR UPDATE",
      [input.rack_id],
      conn,
    );
    if (!rack)
      throw new AppError("INVALID_LOCATION", "Rak tidak ditemukan.", 422);

    const code = locationCode(
      rack.block_code,
      rack.rack_number,
      input.position_number,
    );
    const name = `Posisi ${String(input.position_number).padStart(2, "0")}`;

    const result = await execute(
      "INSERT INTO locations(rack_id,position_number,code,name,active) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
      [input.rack_id, input.position_number, code, name],
      conn,
    );
    const locationId = result.insertId;
    await checkLocation(locationId, productId, conn);
    return locationId;
  }

  if (input.location_id !== undefined) {
    await checkLocation(input.location_id, productId, conn);
    return input.location_id;
  }

  throw new AppError(
    "INVALID_LOCATION",
    "Pilih rak dan isi nomor penempatan.",
    422,
  );
}

async function checkCategory(id: number, conn: PoolConnection) {
  if (!(await rows("SELECT id FROM categories WHERE id=?", [id], conn)).length)
    throw new AppError("INVALID_CATEGORY", "Kategori tidak ditemukan.");
}

export async function createProduct(input: z.infer<typeof productSchema>) {
  return transaction(async (conn) => {
    const locationId = await resolveLocation(input, 0, conn);
    await checkCategory(input.category_id, conn);

    const result = await execute(
      "INSERT INTO products(sku,name,category_id,unit,location_id,qr_token,description,movement_class) VALUES (?,?,?,?,?,?,?,?)",
      [
        input.sku,
        input.name,
        input.category_id,
        input.unit,
        locationId,
        randomUUID(),
        input.description ?? null,
        input.movement_class ?? null,
      ],
      conn,
    );
    await publish(conn, "product");
    return { id: result.insertId };
  });
}

export async function editProduct(
  id: number,
  input: z.infer<typeof editProductSchema>,
) {
  return transaction(async (conn) => {
    const current = await lockProduct(id, conn);
    await ensureUnlocked(current, conn);

    const locationRequested =
      input.location_id !== undefined ||
      input.rack_id !== undefined ||
      input.position_number !== undefined;

    const locationId = locationRequested
      ? await resolveLocation(input, id, conn)
      : current.location_id;

    const updated = { ...current, ...input, location_id: locationId };

    if (updated.active) await checkLocation(locationId, id, conn);
    await checkCategory(updated.category_id, conn);

    await execute(
      "UPDATE products SET name=?,category_id=?,unit=?,location_id=?,description=?,active=?,movement_class=? WHERE id=?",
      [
        updated.name,
        updated.category_id,
        updated.unit,
        locationId,
        updated.description ?? null,
        updated.active ? 1 : 0,
        updated.movement_class ?? null,
        id,
      ],
      conn,
    );
    await publish(conn, "product");
    return { id };
  });
}

export async function regenerate(id: number) {
  return transaction(async (conn) => {
    const p = await lockProduct(id, conn);
    await ensureUnlocked(p, conn);
    await execute(
      "UPDATE products SET qr_token=? WHERE id=?",
      [randomUUID(), id],
      conn,
    );
    await publish(conn, "product");
    return { id };
  });
}
