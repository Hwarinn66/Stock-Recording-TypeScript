import type { PoolConnection } from "mysql2/promise";
import { rows, execute, transaction, publish } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { sqlDateTime } from "@/lib/time";
import type {
  Reservation,
  ReservationHistoryRow,
  ReservationItem,
} from "@/types";

// Sesi pengambilan barang per no reservasi (aplikasi HP): user mengisi no reservasi +
// total item (jumlah jenis barang) sekali, lalu scan barang satu per satu. Status OPEN
// sampai jumlah barang berbeda yang sudah diambil = total_items, lalu DONE otomatis.
// Satu barang hanya sekali per reservasi. Stok tetap berkurang setiap scan.
export const MAX_RESERVATION_ITEMS = 999;

type Row = {
  id: number;
  reservation_number: string;
  total_items: number;
  status: "OPEN" | "DONE";
};

/** Barang keluar yang sudah tersimpan untuk reservasi ini (satu barang dihitung sekali). */
const takenSql =
  "SELECT COUNT(DISTINCT product_id) FROM stock_transactions WHERE reservation_id=r.id AND status='APPROVED' AND transaction_type='OUT'";
const reservationSelect = `SELECT r.id,r.reservation_number,r.total_items,r.status,r.created_at,r.completed_at,u.username created_by_name,(${takenSql}) taken,(SELECT MAX(scanned_at) FROM stock_transactions WHERE reservation_id=r.id) last_activity FROM reservations r LEFT JOIN users u ON u.id=r.created_by`;

const notFound = (number: string) =>
  new AppError(
    "RESERVATION_NOT_FOUND",
    `Reservasi ${number} belum ada. Isi total item untuk memulai.`,
    404,
  );

async function lock(number: string, conn: PoolConnection) {
  const [row] = await rows<Row>(
    "SELECT id,reservation_number,total_items,status FROM reservations WHERE reservation_number=? FOR UPDATE",
    [number],
    conn,
  );
  return row ?? null;
}

async function takenCount(id: number, conn: PoolConnection) {
  const [{ taken }] = await rows<{ taken: number }>(
    // FOR SHARE: baca data terbaru yang sudah COMMIT (bukan snapshot awal transaksi).
    "SELECT COUNT(DISTINCT product_id) taken FROM stock_transactions WHERE reservation_id=? AND status='APPROVED' AND transaction_type='OUT' FOR SHARE",
    [id],
    conn,
  );
  return Number(taken);
}

/** Hitung ulang status dari barang yang sudah diambil (setelah scan, ubah total, atau revisi). */
export async function refreshReservation(id: number, conn: PoolConnection) {
  const [r] = await rows<Row>(
    "SELECT id,reservation_number,total_items,status FROM reservations WHERE id=? FOR UPDATE",
    [id],
    conn,
  );
  const taken = await takenCount(id, conn);
  const status = taken >= r.total_items ? "DONE" : "OPEN";
  if (status !== r.status)
    await execute(
      "UPDATE reservations SET status=?,completed_at=? WHERE id=?",
      [status, status === "DONE" ? sqlDateTime(new Date()) : null, id],
      conn,
    );
  return {
    reservation_number: r.reservation_number,
    total_items: r.total_items,
    taken,
    status,
  };
}

export async function getReservation(number: string) {
  const [r] = await rows<Reservation>(
    reservationSelect + " WHERE r.reservation_number=?",
    [number],
  );
  if (!r) throw notFound(number);
  const items = await rows<ReservationItem>(
    "SELECT t.id,t.transaction_number,t.product_id,p.sku,p.name,p.unit,t.quantity,t.location_code,t.scanned_at,u.username actor_name FROM stock_transactions t JOIN products p ON p.id=t.product_id LEFT JOIN users u ON u.id=t.actor_id WHERE t.reservation_id=? AND t.status='APPROVED' AND t.transaction_type='OUT' ORDER BY t.scanned_at,t.id",
    [r.id],
  );
  return { ...r, taken: Number(r.taken), items };
}

export async function createReservation(
  input: { reservation_number: string; total_items: number },
  userId: number,
) {
  try {
    await execute(
      "INSERT INTO reservations(reservation_number,total_items,created_by,created_at) VALUES (?,?,?,UTC_TIMESTAMP(3))",
      [input.reservation_number, input.total_items, userId],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY")
      throw new AppError(
        "RESERVATION_EXISTS",
        `Reservasi ${input.reservation_number} sudah dimulai. Lanjutkan reservasi itu.`,
        409,
      );
    throw error;
  }
  return getReservation(input.reservation_number);
}

/** Ubah total item (mis. salah ketik). Tidak boleh kurang dari barang yang sudah diambil. */
export async function setReservationTotal(number: string, total: number) {
  await transaction(async (conn) => {
    const r = await lock(number, conn);
    if (!r) throw notFound(number);
    const taken = await takenCount(r.id, conn);
    if (total < taken)
      throw new AppError(
        "RESERVATION_TOTAL_TOO_SMALL",
        `Total item tidak boleh kurang dari barang yang sudah diambil (${taken}).`,
        422,
      );
    await execute(
      "UPDATE reservations SET total_items=? WHERE id=?",
      [total, r.id],
      conn,
    );
    await refreshReservation(r.id, conn);
    await publish(conn, "reservation");
  });
  return getReservation(number);
}

/**
 * Dipanggil di dalam transaksi barang keluar dari HP (produk sudah dikunci): kunci
 * reservasinya (dibuat bila belum ada, mis. sesi dimulai saat HP offline), tolak bila
 * sudah selesai atau barang ini sudah diambil. Kembalikan id untuk ditautkan.
 */
export async function claimReservationItem(
  conn: PoolConnection,
  input: {
    reservation_number: string;
    total_items: number;
    product_id: number;
    userId: number;
    at: Date | null;
  },
) {
  let r = await lock(input.reservation_number, conn);
  if (!r) {
    await execute(
      "INSERT INTO reservations(reservation_number,total_items,created_by,created_at) VALUES (?,?,?,?)",
      [
        input.reservation_number,
        input.total_items,
        input.userId,
        sqlDateTime(input.at ?? new Date()),
      ],
      conn,
    );
    r = (await lock(input.reservation_number, conn))!;
  }
  const [taken] = await rows<{ transaction_number: string }>(
    "SELECT transaction_number FROM stock_transactions WHERE reservation_id=? AND product_id=? AND status='APPROVED' AND transaction_type='OUT' LIMIT 1 FOR SHARE",
    [r.id, input.product_id],
    conn,
  );
  if (taken)
    throw new AppError(
      "RESERVATION_DUPLICATE",
      `Barang ini sudah diambil untuk reservasi ${r.reservation_number} (${taken.transaction_number}). Scan barang lain.`,
      409,
    );
  if (r.status === "DONE")
    throw new AppError(
      "RESERVATION_DONE",
      `Reservasi ${r.reservation_number} sudah selesai (${r.total_items} dari ${r.total_items} barang). Ubah total item bila masih ada barang yang diambil.`,
      409,
    );
  return r.id;
}

/** Ringkasan progres untuk jawaban transaksi (tanpa daftar barang). */
export async function reservationProgress(id: number) {
  const [r] = await rows<Reservation>(reservationSelect + " WHERE r.id=?", [
    id,
  ]);
  return {
    reservation_number: r.reservation_number,
    total_items: r.total_items,
    taken: Number(r.taken),
    status: r.status,
  };
}

// Riwayat reservasi di dashboard: satu baris per no reservasi, termasuk barang keluar
// lama (sebelum sesi reservasi HP) yang hanya punya no reservasi. Progres & status
// hanya ada untuk reservasi yang dimulai sebagai sesi di HP.
const historyGroups = `(SELECT reservation_number FROM reservations UNION SELECT reservation_number FROM stock_transactions WHERE transaction_type='OUT' AND status='APPROVED' AND reservation_number IS NOT NULL) g LEFT JOIN reservations r ON r.reservation_number=g.reservation_number`;
const outOfGroup =
  "FROM stock_transactions t WHERE t.reservation_number=g.reservation_number AND t.transaction_type='OUT' AND t.status='APPROVED'";

export async function reservationHistory(f: {
  q?: string;
  status?: "OPEN" | "DONE";
  page: number;
  limit: number;
}) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.q) {
    where.push(
      "(g.reservation_number LIKE ? OR EXISTS (SELECT 1 FROM stock_transactions t JOIN products p ON p.id=t.product_id WHERE t.reservation_number=g.reservation_number AND t.transaction_type='OUT' AND t.status='APPROVED' AND (p.sku LIKE ? OR p.name LIKE ?)))",
    );
    args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.status) {
    where.push("r.status=?");
    args.push(f.status);
  }
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  const [{ total }] = await rows<{ total: number }>(
    `SELECT COUNT(*) total FROM ${historyGroups}${clause}`,
    args,
  );
  const items = await rows<ReservationHistoryRow>(
    `SELECT * FROM (SELECT g.reservation_number,(SELECT COUNT(DISTINCT t.product_id) ${outOfGroup}) item_count,(SELECT MAX(t.scanned_at) ${outOfGroup}) last_scan,(SELECT GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') FROM stock_transactions t JOIN users u ON u.id=t.actor_id WHERE t.reservation_number=g.reservation_number AND t.transaction_type='OUT' AND t.status='APPROVED') actors,r.total_items,r.status,r.created_at,r.completed_at,(${takenSql}) taken FROM ${historyGroups}${clause}) x ORDER BY COALESCE(x.last_scan,x.created_at) DESC,x.reservation_number DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`,
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

/** Barang yang diambil untuk satu no reservasi (dashboard): semua barang keluar dengan nomor itu. */
export async function reservationHistoryDetail(number: string) {
  const [session] = await rows<Reservation>(
    reservationSelect + " WHERE r.reservation_number=?",
    [number],
  );
  const items = await rows<Omit<ReservationItem, "in_session"> & { in_session: number }>(
    "SELECT t.id,t.transaction_number,t.product_id,p.sku,p.name,p.unit,t.quantity,t.location_code,t.scanned_at,u.username actor_name,(t.reservation_id IS NOT NULL) in_session FROM stock_transactions t JOIN products p ON p.id=t.product_id LEFT JOIN users u ON u.id=t.actor_id WHERE t.reservation_number=? AND t.transaction_type='OUT' AND t.status='APPROVED' ORDER BY t.scanned_at,t.id",
    [number],
  );
  if (!session && !items.length)
    throw new AppError(
      "RESERVATION_NOT_FOUND",
      `Reservasi ${number} tidak ditemukan.`,
      404,
    );
  return {
    reservation_number: number,
    session: session ? { ...session, taken: Number(session.taken) } : null,
    items: items.map((i) => ({ ...i, in_session: Number(i.in_session) === 1 })),
  };
}
