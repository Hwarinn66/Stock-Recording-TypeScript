import { rows, execute, transaction, publish } from "@/lib/db";
import type { PoolConnection } from "mysql2/promise";
import { AppError } from "@/lib/errors";
export type LocationKind = "rooms" | "blocks" | "racks" | "locations";
export const hierarchyJoins =
  " JOIN racks r ON r.id=l.rack_id JOIN blocks b ON b.id=r.block_id JOIN rooms rm ON rm.id=b.room_id";
export const hierarchyFields =
  "rm.id room_id,rm.name room_name,b.id block_id,b.code block_code,r.id rack_id,r.rack_number,l.position_number";
export function locationCode(block: string, rack: number, position: number) {
  return `${block}.${String(rack).padStart(2, "0")}.${String(position).padStart(2, "0")}`;
}
export async function listLocations(kind: LocationKind) {
  if (kind === "rooms") return rows("SELECT * FROM rooms ORDER BY name");
  if (kind === "blocks")
    return rows(
      "SELECT b.*,rm.name room_name FROM blocks b JOIN rooms rm ON rm.id=b.room_id ORDER BY rm.name,b.code",
    );
  if (kind === "racks")
    return rows(
      "SELECT r.*,b.code block_code,b.room_id,rm.name room_name,CONCAT(b.code,'.',IF(r.rack_number<10,CONCAT('0',r.rack_number),r.rack_number)) code FROM racks r JOIN blocks b ON b.id=r.block_id JOIN rooms rm ON rm.id=b.room_id ORDER BY rm.name,b.code,r.rack_number",
    );
  return rows(
    `SELECT l.*,${hierarchyFields},p.id product_id,p.name product_name,p.sku product_sku FROM locations l ${hierarchyJoins} LEFT JOIN products p ON p.location_id=l.id AND p.active=1 ORDER BY rm.name,b.code,r.rack_number,l.position_number`,
  );
}
async function exists(table: LocationKind, id: unknown, conn: PoolConnection) {
  const [item] = await rows(
    `SELECT * FROM ${table} WHERE id=? FOR UPDATE`,
    [id],
    conn,
  );
  if (!item)
    throw new AppError("NOT_FOUND", "Data lokasi tidak ditemukan.", 404);
  return item;
}
export async function mutateLocation(
  kind: LocationKind,
  method: string,
  id: number | undefined,
  input: Record<string, unknown>,
) {
  return transaction(async (conn) => {
    const old = id ? await exists(kind, id, conn) : undefined;
    const child = {
      rooms: ["blocks", "room_id"],
      blocks: ["racks", "block_id"],
      racks: ["locations", "rack_id"],
      locations: ["products", "location_id"],
    }[kind];
    const hasChildren = async () =>
      id &&
      (
        await rows(
          `SELECT id FROM ${child[0]} WHERE ${child[1]}=? LIMIT 1`,
          [id],
          conn,
        )
      ).length > 0;
    if (method === "DELETE") {
      if (await hasChildren())
        throw new AppError(
          "IN_USE",
          "Lokasi masih berisi data. Pindahkan/hapus isi lokasi terlebih dahulu.",
          409,
        );
      await execute(`DELETE FROM ${kind} WHERE id=?`, [id], conn);
    } else if (kind === "rooms") {
      if (id)
        await execute(
          "UPDATE rooms SET name=? WHERE id=?",
          [input.name, id],
          conn,
        );
      else
        id = (
          await execute(
            "INSERT INTO rooms(name) VALUES (?)",
            [input.name],
            conn,
          )
        ).insertId;
    } else if (kind === "blocks") {
      await exists("rooms", input.room_id, conn);
      if (
        old &&
        (old.code !== input.code || old.room_id !== input.room_id) &&
        (await hasChildren())
      )
        throw new AppError(
          "IN_USE",
          "Blok sudah memiliki rak. Kode blok dan ruangan tidak dapat diubah; pindahkan barang ke lokasi baru.",
          409,
        );
      if (id)
        await execute(
          "UPDATE blocks SET room_id=?,code=?,name=? WHERE id=?",
          [input.room_id, input.code, input.name, id],
          conn,
        );
      else
        id = (
          await execute(
            "INSERT INTO blocks(room_id,code,name) VALUES (?,?,?)",
            [input.room_id, input.code, input.name],
            conn,
          )
        ).insertId;
    } else if (kind === "racks") {
      await exists("blocks", input.block_id, conn);
      if (
        old &&
        (old.block_id !== input.block_id ||
          old.rack_number !== input.rack_number) &&
        (await hasChildren())
      )
        throw new AppError(
          "IN_USE",
          "Rak sudah memiliki posisi. Nomor rak dan blok tidak dapat diubah; gunakan lokasi baru.",
          409,
        );
      if (id)
        await execute(
          "UPDATE racks SET block_id=?,rack_number=?,name=? WHERE id=?",
          [input.block_id, input.rack_number, input.name, id],
          conn,
        );
      else
        id = (
          await execute(
            "INSERT INTO racks(block_id,rack_number,name) VALUES (?,?,?)",
            [input.block_id, input.rack_number, input.name],
            conn,
          )
        ).insertId;
    } else {
      const rack = await exists("racks", input.rack_id, conn);
      const block = await exists("blocks", rack.block_id, conn);
      const moved =
        old &&
        (old.rack_id !== input.rack_id ||
          old.position_number !== input.position_number);
      if (
        moved &&
        ((await hasChildren()) ||
          (
            await rows(
              "SELECT id FROM stock_transactions WHERE location_id=? LIMIT 1",
              [id],
              conn,
            )
          ).length)
      )
        throw new AppError(
          "IN_USE",
          "Posisi sudah dipakai atau memiliki histori. Buat posisi baru lalu pindahkan barang melalui Edit Barang.",
          409,
        );
      if (
        id &&
        input.active === false &&
        (
          await rows(
            "SELECT id FROM products WHERE location_id=? AND active=1 LIMIT 1",
            [id],
            conn,
          )
        ).length
      )
        throw new AppError(
          "IN_USE",
          "Posisi masih ditempati barang aktif.",
          409,
        );
      // Kode tersimpan dipertahankan bila posisi tidak dipindah (mis. kode ERP A.01.01.001).
      const code =
        old && !moved
          ? String(old.code)
          : locationCode(
              String(block.code),
              Number(rack.rack_number),
              Number(input.position_number),
            );
      const values = [
        input.rack_id,
        input.position_number,
        code,
        input.name,
        input.description ?? null,
        input.active === false ? 0 : 1,
      ];
      if (id)
        await execute(
          "UPDATE locations SET rack_id=?,position_number=?,code=?,name=?,description=?,active=? WHERE id=?",
          [...values, id],
          conn,
        );
      else
        id = (
          await execute(
            "INSERT INTO locations(rack_id,position_number,code,name,description,active) VALUES (?,?,?,?,?,?)",
            values,
            conn,
          )
        ).insertId;
    }
    await publish(conn, "location");
    return { id };
  });
}
