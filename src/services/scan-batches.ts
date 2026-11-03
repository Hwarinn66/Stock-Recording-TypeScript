import type { PoolConnection } from "mysql2/promise";
import { rows, execute, transaction, publish } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { sqlDateTime } from "@/lib/time";
import type { Batch, BatchHistoryRow, BatchItem } from "@/types";

// Sesi scan di aplikasi HP: user mengisi kode sekali (no reservasi untuk barang keluar,
// kode masuk untuk barang masuk) + total item (jumlah jenis barang), lalu scan barang
// satu per satu. Status OPEN sampai jumlah barang berbeda yang tersimpan = total_items,
// lalu DONE otomatis. Satu barang hanya sekali per sesi. Stok tetap berubah setiap scan.
export type BatchKind = {
  table: "reservations" | "receipts";
  /** Kolom kode di tabel sesi & di stock_transactions. */
  key: "reservation_number" | "in_code";
  /** Kolom penaut di stock_transactions. */
  fk: "reservation_id" | "receipt_id";
  type: "OUT" | "IN";
  /** Awalan kode error, mis. RESERVATION_DUPLICATE / RECEIPT_DUPLICATE. */
  error: "RESERVATION" | "RECEIPT";
  /** "Reservasi" / "Kode masuk" dalam pesan. */
  label: string;
  /** Barang "diambil" (keluar) / "masuk". */
  verb: string;
  event: string;
};

export const RESERVATION: BatchKind = {
  table: "reservations",
  key: "reservation_number",
  fk: "reservation_id",
  type: "OUT",
  error: "RESERVATION",
  label: "Reservasi",
  verb: "diambil",
  event: "reservation",
};

export const RECEIPT: BatchKind = {
  table: "receipts",
  key: "in_code",
  fk: "receipt_id",
  type: "IN",
  error: "RECEIPT",
  label: "Kode masuk",
  verb: "masuk",
  event: "receipt",
};

type Row = { id: number; code: string; total_items: number; status: "OPEN" | "DONE" };

const takenSql = (k: BatchKind) =>
  `SELECT COUNT(DISTINCT product_id) FROM stock_transactions WHERE ${k.fk}=r.id AND status='APPROVED' AND transaction_type='${k.type}'`;
/** Ringkasan sesi; `code` = kode sesi, juga dikembalikan dengan nama kolom aslinya. */
const batchSelect = (k: BatchKind) =>
  `SELECT r.id,r.${k.key} code,r.${k.key},r.total_items,r.status,r.created_at,r.completed_at,u.username created_by_name,(${takenSql(k)}) taken,(SELECT MAX(scanned_at) FROM stock_transactions WHERE ${k.fk}=r.id) last_activity FROM ${k.table} r LEFT JOIN users u ON u.id=r.created_by`;
const itemSelect = (k: BatchKind) =>
  `SELECT t.id,t.transaction_number,t.product_id,p.sku,p.name,p.unit,t.quantity,t.location_code,t.scanned_at,u.username actor_name,(t.${k.fk} IS NOT NULL) in_session FROM stock_transactions t JOIN products p ON p.id=t.product_id LEFT JOIN users u ON u.id=t.actor_id`;

const lower = (k: BatchKind) => k.label.toLowerCase();
const notFound = (k: BatchKind, code: string) =>
  new AppError(
    `${k.error}_NOT_FOUND`,
    `${k.label} ${code} belum ada. Isi total item untuk memulai.`,
    404,
  );

async function lock(k: BatchKind, code: string, conn: PoolConnection) {
  const [row] = await rows<Row>(
    `SELECT id,${k.key} code,total_items,status FROM ${k.table} WHERE ${k.key}=? FOR UPDATE`,
    [code],
    conn,
  );
  return row ?? null;
}

async function takenCount(k: BatchKind, id: number, conn: PoolConnection) {
  const [{ taken }] = await rows<{ taken: number }>(
    // FOR SHARE: baca data terbaru yang sudah COMMIT (bukan snapshot awal transaksi).
    `SELECT COUNT(DISTINCT product_id) taken FROM stock_transactions WHERE ${k.fk}=? AND status='APPROVED' AND transaction_type='${k.type}' FOR SHARE`,
    [id],
    conn,
  );
  return Number(taken);
}

/** Progres untuk jawaban transaksi: { reservation_number | in_code, total_items, taken, status }. */
const progress = (
  k: BatchKind,
  r: { code: string; total_items: number; status: "OPEN" | "DONE" },
  taken: number,
) => ({ [k.key]: r.code, total_items: r.total_items, taken, status: r.status });

/** Hitung ulang status dari barang yang sudah tersimpan (setelah scan, ubah total, atau revisi). */
export async function refreshBatch(k: BatchKind, id: number, conn: PoolConnection) {
  const [r] = await rows<Row>(
    `SELECT id,${k.key} code,total_items,status FROM ${k.table} WHERE id=? FOR UPDATE`,
    [id],
    conn,
  );
  const taken = await takenCount(k, id, conn);
  const status = taken >= r.total_items ? "DONE" : "OPEN";
  if (status !== r.status)
    await execute(
      `UPDATE ${k.table} SET status=?,completed_at=? WHERE id=?`,
      [status, status === "DONE" ? sqlDateTime(new Date()) : null, id],
      conn,
    );
  return progress(k, { ...r, status }, taken);
}

export async function getBatch(k: BatchKind, code: string) {
  const [r] = await rows<Batch>(batchSelect(k) + ` WHERE r.${k.key}=?`, [code]);
  if (!r) throw notFound(k, code);
  const items = await rows<BatchItem>(
    itemSelect(k) +
      ` WHERE t.${k.fk}=? AND t.status='APPROVED' AND t.transaction_type='${k.type}' ORDER BY t.scanned_at,t.id`,
    [r.id],
  );
  return {
    ...r,
    taken: Number(r.taken),
    items: items.map((i) => ({ ...i, in_session: true })),
  };
}

export async function createBatch(
  k: BatchKind,
  input: { code: string; total_items: number },
  userId: number,
) {
  try {
    await execute(
      `INSERT INTO ${k.table}(${k.key},total_items,created_by,created_at) VALUES (?,?,?,UTC_TIMESTAMP(3))`,
      [input.code, input.total_items, userId],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY")
      throw new AppError(
        `${k.error}_EXISTS`,
        `${k.label} ${input.code} sudah dimulai. Lanjutkan ${lower(k)} itu.`,
        409,
      );
    throw error;
  }
  return getBatch(k, input.code);
}

/** Ubah total item (mis. salah ketik). Tidak boleh kurang dari barang yang sudah tersimpan. */
export async function setBatchTotal(k: BatchKind, code: string, total: number) {
  await transaction(async (conn) => {
    const r = await lock(k, code, conn);
    if (!r) throw notFound(k, code);
    const taken = await takenCount(k, r.id, conn);
    if (total < taken)
      throw new AppError(
        `${k.error}_TOTAL_TOO_SMALL`,
        `Total item tidak boleh kurang dari barang yang sudah ${k.verb} (${taken}).`,
        422,
      );
    await execute(`UPDATE ${k.table} SET total_items=? WHERE id=?`, [total, r.id], conn);
    await refreshBatch(k, r.id, conn);
    await publish(conn, k.event);
  });
  return getBatch(k, code);
}

/**
 * Dipanggil di dalam transaksi barang keluar/masuk dari HP (produk sudah dikunci): kunci
 * sesinya (dibuat bila belum ada, mis. sesi dimulai saat HP offline), tolak bila sudah
 * selesai atau barang ini sudah tersimpan di sesi itu. Kembalikan id untuk ditautkan.
 */
export async function claimBatchItem(
  k: BatchKind,
  conn: PoolConnection,
  input: {
    code: string;
    total_items: number;
    product_id: number;
    userId: number;
    at: Date | null;
  },
) {
  let r = await lock(k, input.code, conn);
  if (!r) {
    await execute(
      `INSERT INTO ${k.table}(${k.key},total_items,created_by,created_at) VALUES (?,?,?,?)`,
      [input.code, input.total_items, input.userId, sqlDateTime(input.at ?? new Date())],
      conn,
    );
    r = (await lock(k, input.code, conn))!;
  }
  const [taken] = await rows<{ transaction_number: string }>(
    `SELECT transaction_number FROM stock_transactions WHERE ${k.fk}=? AND product_id=? AND status='APPROVED' AND transaction_type='${k.type}' LIMIT 1 FOR SHARE`,
    [r.id, input.product_id],
    conn,
  );
  if (taken)
    throw new AppError(
      `${k.error}_DUPLICATE`,
      `Barang ini sudah ${k.verb} untuk ${lower(k)} ${r.code} (${taken.transaction_number}). Scan barang lain.`,
      409,
    );
  if (r.status === "DONE")
    throw new AppError(
      `${k.error}_DONE`,
      `${k.label} ${r.code} sudah selesai (${r.total_items} dari ${r.total_items} barang). Ubah total item bila masih ada barang yang ${k.verb}.`,
      409,
    );
  return r.id;
}

/** Ringkasan progres untuk jawaban transaksi (tanpa daftar barang). */
export async function batchProgress(k: BatchKind, id: number) {
  const [r] = await rows<Batch>(batchSelect(k) + " WHERE r.id=?", [id]);
  return progress(k, r, Number(r.taken));
}

// Riwayat di dashboard: satu baris per kode, termasuk transaksi lama (sebelum sesi HP)
// yang hanya punya kodenya. Progres & status hanya ada untuk sesi yang dimulai di HP.
const historyGroups = (k: BatchKind) =>
  `(SELECT ${k.key} FROM ${k.table} UNION SELECT ${k.key} FROM stock_transactions WHERE transaction_type='${k.type}' AND status='APPROVED' AND ${k.key} IS NOT NULL) g LEFT JOIN ${k.table} r ON r.${k.key}=g.${k.key}`;
const ofGroup = (k: BatchKind) =>
  `FROM stock_transactions t WHERE t.${k.key}=g.${k.key} AND t.transaction_type='${k.type}' AND t.status='APPROVED'`;

export async function batchHistory(
  k: BatchKind,
  f: { q?: string; status?: "OPEN" | "DONE"; page: number; limit: number },
) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.q) {
    where.push(
      `(g.${k.key} LIKE ? OR EXISTS (SELECT 1 FROM stock_transactions t JOIN products p ON p.id=t.product_id WHERE t.${k.key}=g.${k.key} AND t.transaction_type='${k.type}' AND t.status='APPROVED' AND (p.sku LIKE ? OR p.name LIKE ?)))`,
    );
    args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.status) {
    where.push("r.status=?");
    args.push(f.status);
  }
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  const [{ total }] = await rows<{ total: number }>(
    `SELECT COUNT(*) total FROM ${historyGroups(k)}${clause}`,
    args,
  );
  const items = await rows<BatchHistoryRow>(
    `SELECT * FROM (SELECT g.${k.key} code,g.${k.key},(SELECT COUNT(DISTINCT t.product_id) ${ofGroup(k)}) item_count,(SELECT MAX(t.scanned_at) ${ofGroup(k)}) last_scan,(SELECT GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') FROM stock_transactions t JOIN users u ON u.id=t.actor_id WHERE t.${k.key}=g.${k.key} AND t.transaction_type='${k.type}' AND t.status='APPROVED') actors,r.total_items,r.status,r.created_at,r.completed_at,(${takenSql(k)}) taken FROM ${historyGroups(k)}${clause}) x ORDER BY COALESCE(x.last_scan,x.created_at) DESC,x.code DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`,
    args,
  );
  return {
    items: items.map((r) => ({
      ...r,
      item_count: Number(r.item_count),
      taken: r.status ? Number(r.taken) : null,
    })),
    total: Number(total),
    page: f.page,
    limit: f.limit,
  };
}

/** Dashboard: semua barang yang tercatat dengan kode itu, ditandai di dalam/luar sesi HP. */
export async function batchHistoryDetail(k: BatchKind, code: string) {
  const [session] = await rows<Batch>(batchSelect(k) + ` WHERE r.${k.key}=?`, [code]);
  const items = await rows<Omit<BatchItem, "in_session"> & { in_session: number }>(
    itemSelect(k) +
      ` WHERE t.${k.key}=? AND t.transaction_type='${k.type}' AND t.status='APPROVED' ORDER BY t.scanned_at,t.id`,
    [code],
  );
  if (!session && !items.length)
    throw new AppError(
      `${k.error}_NOT_FOUND`,
      `${k.label} ${code} tidak ditemukan.`,
      404,
    );
  return {
    code,
    [k.key]: code,
    session: session ? { ...session, taken: Number(session.taken) } : null,
    items: items.map((i) => ({ ...i, in_session: Number(i.in_session) === 1 })),
  };
}
