import { hierarchyJoins, hierarchyFields } from "./locations";
import type { PoolConnection } from "mysql2/promise";
import { rows, execute, transaction, publish } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { localDay, sqlDateTime } from "@/lib/time";
import { inCodeExample, isAtkCategory, validInCode } from "@/lib/in-code";
import {
  MAX_QUANTITY,
  calculateStock,
  roundStock,
  validAmount,
} from "@/lib/stock";
import type { Product, StockTransaction } from "@/types";
export const productColumns =
  "p.id,p.sku,p.name,p.category_id,p.unit,p.movement_class,p.stock,p.location_id,p.qr_token,p.description,p.active,p.created_at,p.updated_at";
export type LockedProduct = Omit<Product, "category_name">;
export const lockedSelect = `SELECT ${productColumns},l.code location_code,${hierarchyFields} FROM products p JOIN locations l ON l.id=p.location_id ${hierarchyJoins}`;
export async function lockProduct(id: number, conn: PoolConnection) {
  const [product] = await rows<LockedProduct>(
    lockedSelect + " WHERE p.id=? FOR UPDATE",
    [id],
    conn,
  );
  if (!product) throw new AppError("NOT_FOUND", "Barang tidak ditemukan.", 404);
  return product;
}
const pendingError = (
  product: LockedProduct,
  pending: Pick<StockTransaction, "transaction_number">,
) =>
  new AppError(
    "PRODUCT_PENDING",
    `Barang masih menunggu proses. ${product.name}. Nomor transaksi: ${pending.transaction_number}. Selesaikan transaksi sebelumnya terlebih dahulu.`,
    409,
    { product, transaction: pending },
  );
const stockEmptyError = (product: LockedProduct) =>
  new AppError(
    "STOCK_EMPTY",
    `STOK HABIS. ${product.name}. Stok: 0 ${product.unit}.`,
    409,
    { product },
  );
export async function ensureUnlocked(
  product: LockedProduct,
  conn: PoolConnection,
) {
  const [pending] = await rows<StockTransaction>(
    "SELECT * FROM stock_transactions WHERE product_id=? AND status='PENDING' LIMIT 1 FOR UPDATE",
    [product.id],
    conn,
  );
  if (pending) throw pendingError(product, pending);
}
async function lockByToken(token: string, conn: PoolConnection) {
  const [identity] = await rows<{ id: number }>(
    "SELECT id FROM products WHERE qr_token=?",
    [token],
    conn,
  );
  if (!identity) throw new AppError("QR_NOT_FOUND", "QR tidak terdaftar.", 404);
  const p = await lockProduct(identity.id, conn);
  if (p.qr_token !== token)
    throw new AppError(
      "QR_NOT_FOUND",
      "QR telah diganti. Gunakan label terbaru.",
      404,
    );
  if (!p.active)
    throw new AppError("PRODUCT_INACTIVE", "Barang sudah tidak aktif.", 409);
  await ensureUnlocked(p, conn);
  return p;
}
/** `day` (zona aplikasi) default hari ini; catatan buku darurat memakai tanggal kejadiannya. */
export async function nextNumber(
  type: string,
  conn: PoolConnection,
  day = localDay(),
) {
  const kind = type === "ADJUSTMENT" ? "ADJ" : type;
  await execute(
    "INSERT INTO transaction_sequences(sequence_date,kind,last_number) VALUES (?,?,1) ON DUPLICATE KEY UPDATE last_number=last_number+1",
    [day, kind],
    conn,
  );
  const [sequence] = await rows<{ last_number: number }>(
    "SELECT last_number FROM transaction_sequences WHERE sequence_date=? AND kind=?",
    [day, kind],
    conn,
  );
  return `${kind}-${day.replaceAll("-", "")}-${String(sequence.last_number).padStart(4, "0")}`;
}
/**
 * Daftar barang aktif untuk disimpan di HP: saat server tidak terjangkau, QR tetap
 * dikenali dari daftar ini dan transaksi masuk antrean offline.
 */
export function scanCatalog() {
  return rows(
    `SELECT p.id,p.sku,p.name,p.unit,p.stock,p.qr_token,c.name category_name,l.code location_code,rm.name room_name FROM products p JOIN categories c ON c.id=p.category_id JOIN locations l ON l.id=p.location_id${hierarchyJoins} WHERE p.active=1 ORDER BY p.id`,
  );
}
/** Barang + nama kategori, untuk dibaca tanpa kunci (HP perlu kategori: ATK punya format Kode Masuk sendiri). */
const viewSelect = `SELECT ${productColumns},c.name category_name,l.code location_code,${hierarchyFields} FROM products p JOIN categories c ON c.id=p.category_id JOIN locations l ON l.id=p.location_id ${hierarchyJoins}`;
type ViewProduct = LockedProduct & { category_name: string };
// Aplikasi scanner HP: cek barang setelah QR dibaca, sebelum user mengisi jumlah.
export async function lookup(token: string, mode: "IN" | "OUT") {
  const [p] = await rows<ViewProduct>(viewSelect + " WHERE p.qr_token=?", [
    token,
  ]);
  if (!p) throw new AppError("QR_NOT_FOUND", "QR tidak terdaftar.", 404);
  if (!p.active)
    throw new AppError("PRODUCT_INACTIVE", "Barang sudah tidak aktif.", 409);
  const [pending] = await rows<Pick<StockTransaction, "transaction_number">>(
    "SELECT transaction_number FROM stock_transactions WHERE product_id=? AND status='PENDING' LIMIT 1",
    [p.id],
  );
  if (pending) throw pendingError(p, pending);
  if (mode === "OUT" && p.stock === 0) throw stockEmptyError(p);
  return p;
}
/** Transaksi HP yang sudah tersimpan dengan kunci pengiriman ini (dijawab ulang, bukan dicatat lagi). */
async function recorded(ref: string) {
  const [t] = await rows<StockTransaction>(
    "SELECT * FROM stock_transactions WHERE client_ref=?",
    [ref],
  );
  if (!t) return null;
  const [product] = await rows<ViewProduct>(viewSelect + " WHERE p.id=?", [
    t.product_id,
  ]);
  return {
    id: t.id,
    transaction_number: t.transaction_number,
    mode: t.transaction_type as "IN" | "OUT",
    quantity: t.quantity as number,
    stock_before: t.stock_before as number,
    stock_after: t.stock_after as number,
    reservation_number: t.reservation_number,
    in_code: t.in_code ?? null,
    product,
    replayed: true,
  };
}
/**
 * Halaman "Cek Barang" di HP: detail lengkap barang hasil scan, termasuk barang
 * nonaktif, transaksi menunggu, total 30 hari, dan 10 transaksi terakhir.
 */
export async function productInfo(token: string) {
  const [p] = await rows<
    ViewProduct & {
      block_name: string;
      rack_name: string;
    }
  >(
    `SELECT ${productColumns},c.name category_name,l.code location_code,${hierarchyFields},b.name block_name,r.name rack_name FROM products p JOIN categories c ON c.id=p.category_id JOIN locations l ON l.id=p.location_id ${hierarchyJoins} WHERE p.qr_token=?`,
    [token],
  );
  if (!p) throw new AppError("QR_NOT_FOUND", "QR tidak terdaftar.", 404);
  const [[pending], [totals], history] = await Promise.all([
    rows<{ transaction_number: string }>(
      "SELECT transaction_number FROM stock_transactions WHERE product_id=? AND status='PENDING' LIMIT 1",
      [p.id],
    ),
    rows<{ in_30: number; out_30: number }>(
      "SELECT COALESCE(SUM(CASE WHEN transaction_type='IN' THEN quantity END),0) in_30,COALESCE(SUM(CASE WHEN transaction_type='OUT' THEN quantity END),0) out_30 FROM stock_transactions WHERE product_id=? AND status='APPROVED' AND approved_at>=TIMESTAMPADD(DAY,-30,UTC_TIMESTAMP(3))",
      [p.id],
    ),
    rows<StockTransaction>(
      transactionSelect +
        " WHERE t.product_id=? ORDER BY t.scanned_at DESC,t.id DESC LIMIT 10",
      [p.id],
    ),
  ]);
  return {
    product: p,
    pending: pending?.transaction_number ?? null,
    in_30: Number(totals.in_30),
    out_30: Number(totals.out_30),
    history,
  };
}
// Aplikasi scanner HP: transaksi langsung APPROVED dan stok langsung berubah.
// `client_ref` (UUID dari HP) membuat kiriman ulang aman: sinyal putus setelah server
// menyimpan, atau antrean offline yang terkirim dua kali, tidak mencatat transaksi kedua.
export async function record(
  input: {
    qr_token: string;
    mode: "IN" | "OUT";
    quantity: number;
    reservation_number?: string;
    client_ref?: string;
    recorded_at?: string;
    in_code?: string;
  },
  userId: number,
) {
  const ref = input.client_ref ?? null;
  if (ref) {
    const done = await recorded(ref);
    if (done) return done;
  }
  const at = input.recorded_at ? new Date(input.recorded_at) : null;
  if (
    at &&
    (at.getTime() > Date.now() + 5 * 60000 ||
      at.getTime() < Date.now() - 7 * 86400000)
  )
    throw new AppError(
      "INVALID_TIME",
      "Waktu transaksi di HP tidak wajar (lebih dari 7 hari lalu atau di masa depan). Periksa jam HP, lalu catat lewat buku darurat/koreksi stok.",
    );
  try {
    return await transaction(async (conn) => {
      const p = await lockByToken(input.qr_token, conn);
      const [category] = await rows<{ name: string }>(
        "SELECT name FROM categories WHERE id=?",
        [p.category_id],
        conn,
      );
      const inCode = input.mode === "IN" ? (input.in_code ?? "") : null;
      const atk = isAtkCategory(category?.name);
      if (inCode !== null && !validInCode(inCode, atk))
        throw new AppError(
          "INVALID_IN_CODE",
          `Kode masuk harus seperti ${inCodeExample(atk)}${atk ? " (barang ATK diawali ATK.)" : ""}.`,
          422,
        );
      const after = calculateStock(p.stock, input.quantity, input.mode, p.unit);
      const number = await nextNumber(
        input.mode,
        conn,
        localDay(at ?? new Date()),
      );
      const when = at ? sqlDateTime(at) : null;
      await execute(
        "UPDATE products SET stock=? WHERE id=?",
        [after, p.id],
        conn,
      );
      const result = await execute(
        "INSERT INTO stock_transactions(transaction_number,product_id,location_id,location_code,room_name,transaction_type,quantity,stock_before,stock_after,status,reservation_number,in_code,client_ref,notes,scanned_at,approved_at,actor_id) VALUES (?,?,?,?,?,?,?,?,?,'APPROVED',?,?,?,?,COALESCE(?,UTC_TIMESTAMP(3)),COALESCE(?,UTC_TIMESTAMP(3)),?)",
        [
          number,
          p.id,
          p.location_id,
          p.location_code,
          p.room_name,
          input.mode,
          input.quantity,
          p.stock,
          after,
          input.reservation_number ?? null,
          inCode,
          ref,
          at ? "Dikirim dari antrean offline HP" : null,
          when,
          when,
          userId,
        ],
        conn,
      );
      await publish(conn, "transaction");
      return {
        id: result.insertId,
        transaction_number: number,
        mode: input.mode,
        quantity: input.quantity,
        stock_before: p.stock,
        stock_after: after,
        reservation_number: input.reservation_number ?? null,
        in_code: inCode,
        product: { ...p, category_name: category?.name ?? null },
        replayed: false,
      };
    });
  } catch (error) {
    // Kiriman dengan kunci sama yang berjalan bersamaan sudah tersimpan lebih dulu:
    // jawab dengan transaksi itu, bukan error duplikat/stok tidak cukup.
    if (ref) {
      const done = await recorded(ref);
      if (done) return done;
    }
    throw error;
  }
}
export async function scan(token: string, mode: "IN" | "OUT", userId: number) {
  return transaction(async (conn) => {
    const p = await lockByToken(token, conn);
    if (mode === "OUT" && p.stock === 0) throw stockEmptyError(p);
    const number = await nextNumber(mode, conn);
    const result = await execute(
      "INSERT INTO stock_transactions(transaction_number,product_id,location_id,location_code,room_name,transaction_type,actor_id) VALUES (?,?,?,?,?,?,?)",
      [number, p.id, p.location_id, p.location_code, p.room_name, mode, userId],
      conn,
    );
    await publish(conn, "scan");
    return {
      id: result.insertId,
      transaction_number: number,
      status: "PENDING",
      product: p,
      mode,
    };
  });
}
async function lockedTransaction(id: number, conn: PoolConnection) {
  const [identity] = await rows<{ product_id: number }>(
    "SELECT product_id FROM stock_transactions WHERE id=?",
    [id],
    conn,
  );
  if (!identity)
    throw new AppError("NOT_FOUND", "Transaksi tidak ditemukan.", 404);
  // Semua jalur mutasi memakai urutan lock yang sama: product, lalu transaction.
  const product = await lockProduct(identity.product_id, conn);
  const [item] = await rows<StockTransaction>(
    "SELECT * FROM stock_transactions WHERE id=? FOR UPDATE",
    [id],
    conn,
  );
  if (item.status !== "PENDING")
    throw new AppError("ALREADY_PROCESSED", "Transaksi sudah diproses.", 409);
  return { product, item };
}
export async function setQuantity(id: number, quantity: number) {
  return transaction(async (conn) => {
    const { product, item } = await lockedTransaction(id, conn);
    calculateStock(
      product.stock,
      quantity,
      item.transaction_type as "IN" | "OUT",
      product.unit,
    );
    await execute(
      "UPDATE stock_transactions SET quantity=? WHERE id=?",
      [quantity, id],
      conn,
    );
    await publish(conn, "quantity");
    return { id, quantity };
  });
}
export async function approve(
  id: number,
  quantity: number | undefined,
  userId: number,
) {
  return transaction(async (conn) => {
    const { product, item } = await lockedTransaction(id, conn);
    if (!product.active)
      throw new AppError("PRODUCT_INACTIVE", "Barang sudah tidak aktif.", 409);
    const amount = quantity ?? item.quantity;
    if (amount === null)
      throw new AppError("INVALID_QUANTITY", "Isi quantity terlebih dahulu.");
    const after = calculateStock(
      product.stock,
      amount,
      item.transaction_type as "IN" | "OUT",
      product.unit,
    );
    await execute(
      "UPDATE products SET stock=? WHERE id=?",
      [after, product.id],
      conn,
    );
    await execute(
      "UPDATE stock_transactions SET quantity=?,stock_before=?,stock_after=?,status='APPROVED',approved_at=UTC_TIMESTAMP(3),actor_id=? WHERE id=?",
      [amount, product.stock, after, userId, id],
      conn,
    );
    await publish(conn, "approved");
    return {
      id,
      quantity: amount,
      stock_before: product.stock,
      stock_after: after,
      type: item.transaction_type,
      unit: product.unit,
    };
  });
}
export async function cancel(id: number) {
  return transaction(async (conn) => {
    await lockedTransaction(id, conn);
    await execute(
      "UPDATE stock_transactions SET status='CANCELLED',cancelled_at=UTC_TIMESTAMP(3) WHERE id=?",
      [id],
      conn,
    );
    await publish(conn, "cancelled");
    return { id };
  });
}
/**
 * Revisi transaksi IN/OUT yang sudah tersimpan (salah ketik jumlah atau no reservasi).
 * Stok barang disesuaikan sebesar selisih jumlah; jejak revisi ditambahkan ke notes.
 */
export async function revise(
  id: number,
  input: { quantity?: number; reservation_number?: string; reason?: string },
  user: { id: number; username: string },
) {
  return transaction(async (conn) => {
    const [identity] = await rows<{ product_id: number }>(
      "SELECT product_id FROM stock_transactions WHERE id=?",
      [id],
      conn,
    );
    if (!identity)
      throw new AppError("NOT_FOUND", "Transaksi tidak ditemukan.", 404);
    // Urutan lock sama dengan jalur mutasi lain: product, lalu transaction.
    const product = await lockProduct(identity.product_id, conn);
    const [item] = await rows<StockTransaction>(
      "SELECT * FROM stock_transactions WHERE id=? FOR UPDATE",
      [id],
      conn,
    );
    if (item.status !== "APPROVED" || item.transaction_type === "ADJUSTMENT")
      throw new AppError(
        "NOT_REVISABLE",
        "Hanya transaksi barang masuk/keluar yang sudah tersimpan yang bisa direvisi.",
        409,
      );
    if (!product.active)
      throw new AppError("PRODUCT_INACTIVE", "Barang sudah tidak aktif.", 409);
    await ensureUnlocked(product, conn);
    const type = item.transaction_type;
    const oldQuantity = item.quantity ?? 0;
    let quantity = oldQuantity;
    let stock = product.stock;
    let itemAfter = item.stock_after;
    let reservation = item.reservation_number;
    const changes: string[] = [];
    if (input.quantity !== undefined && input.quantity !== oldQuantity) {
      if (!validAmount(input.quantity, product.unit))
        throw new AppError(
          "INVALID_QUANTITY",
          `Jumlah untuk satuan ${product.unit} harus bilangan bulat.`,
        );
      quantity = input.quantity;
      // IN lebih banyak → stok naik; OUT lebih banyak → stok turun.
      const delta = roundStock(quantity - oldQuantity);
      stock = roundStock(product.stock + (type === "IN" ? delta : -delta));
      if (stock < 0)
        throw new AppError(
          "STOCK_NOT_ENOUGH",
          `Revisi membuat stok minus. Stok saat ini: ${product.stock} ${product.unit}.`,
          409,
        );
      if (stock > MAX_QUANTITY)
        throw new AppError("STOCK_OVERFLOW", "Stok melampaui batas sistem.");
      itemAfter = roundStock(
        (item.stock_before ?? 0) + (type === "IN" ? quantity : -quantity),
      );
      changes.push(`jumlah ${oldQuantity} → ${quantity} ${product.unit}`);
    }
    if (
      input.reservation_number !== undefined &&
      input.reservation_number !== item.reservation_number
    ) {
      if (type !== "OUT")
        throw new AppError(
          "VALIDATION_ERROR",
          "No reservasi hanya untuk barang keluar.",
        );
      reservation = input.reservation_number;
      changes.push(
        `no reservasi ${item.reservation_number ?? "—"} → ${reservation}`,
      );
    }
    if (!changes.length)
      throw new AppError("NO_CHANGE", "Tidak ada perubahan.");
    const when = new Intl.DateTimeFormat("id-ID", {
      timeZone: process.env.APP_TIMEZONE || "Asia/Jakarta",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date());
    const log = `Revisi ${when} oleh ${user.username}: ${changes.join(", ")}${input.reason ? ` (alasan: ${input.reason})` : ""}`;
    const notes = item.notes ? `${item.notes}\n${log}` : log;
    if (stock !== product.stock)
      await execute(
        "UPDATE products SET stock=? WHERE id=?",
        [stock, product.id],
        conn,
      );
    await execute(
      "UPDATE stock_transactions SET quantity=?,stock_after=?,reservation_number=?,notes=? WHERE id=?",
      [quantity, itemAfter, reservation, notes, id],
      conn,
    );
    await publish(conn, "revised");
    return {
      id,
      transaction_number: item.transaction_number,
      quantity,
      reservation_number: reservation,
      stock,
      notes,
    };
  });
}
export async function adjustment(
  input: {
    product_id: number;
    physical_stock: number;
    expected_stock: number;
    notes: string;
  },
  userId: number,
) {
  return transaction(async (conn) => {
    const p = await lockProduct(input.product_id, conn);
    if (!p.active)
      throw new AppError("PRODUCT_INACTIVE", "Barang sudah tidak aktif.", 409);
    await ensureUnlocked(p, conn);
    if (p.stock !== input.expected_stock)
      throw new AppError(
        "STALE_STOCK",
        "Stok berubah sejak ditampilkan. Muat ulang lalu periksa kembali.",
        409,
      );
    if (!validAmount(input.physical_stock, p.unit))
      throw new AppError(
        "INVALID_QUANTITY",
        `Stok fisik untuk satuan ${p.unit} harus bilangan bulat.`,
      );
    const delta = roundStock(input.physical_stock - p.stock);
    if (delta === 0)
      throw new AppError("NO_CHANGE", "Stok fisik sama dengan stok sistem.");
    const number = await nextNumber("ADJUSTMENT", conn);
    await execute(
      "UPDATE products SET stock=? WHERE id=?",
      [input.physical_stock, p.id],
      conn,
    );
    const result = await execute(
      "INSERT INTO stock_transactions(transaction_number,product_id,location_id,location_code,room_name,transaction_type,quantity,stock_before,stock_after,status,notes,approved_at,actor_id) VALUES (?,?,?,?,?,'ADJUSTMENT',?,?,?,'APPROVED',?,UTC_TIMESTAMP(3),?)",
      [
        number,
        p.id,
        p.location_id,
        p.location_code,
        p.room_name,
        delta,
        p.stock,
        input.physical_stock,
        input.notes,
        userId,
      ],
      conn,
    );
    await publish(conn, "adjustment");
    return { id: result.insertId, transaction_number: number };
  });
}
export const transactionSelect =
  "SELECT t.*,p.name,p.sku,p.unit,p.stock,u.username actor_name FROM stock_transactions t JOIN products p ON p.id=t.product_id LEFT JOIN users u ON u.id=t.actor_id";
export function pending() {
  return rows<StockTransaction>(
    transactionSelect + " WHERE t.status='PENDING' ORDER BY t.scanned_at,t.id",
  );
}
