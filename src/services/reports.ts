import { hierarchyJoins } from "./locations";
import { z } from "zod";
import { rows } from "@/lib/db";
import { listSchema, productListSchema } from "@/validators";
import { productListSelect } from "./products";
import { transactionSelect } from "./transactions";
import type { InventoryProduct, StockTransaction } from "@/types";
type Filters = z.infer<typeof listSchema>;
export async function listProducts(f: z.infer<typeof productListSchema>) {
  // OUT totals support a separate ranking only; manual labels never depend on them.
  const movementJoin = ` LEFT JOIN (
    SELECT product_id,SUM(quantity) out_total FROM stock_transactions
    WHERE transaction_type='OUT' AND status='APPROVED' AND approved_at<=UTC_TIMESTAMP(3)
    GROUP BY product_id
  ) mv ON mv.product_id=p.id`;

  const where = ["1=1"];
  const args: unknown[] = [];
  if (f.active !== "all") {
    where.push("p.active=?");
    args.push(Number(f.active));
  }
  if (f.q) {
    where.push(
      "(p.name LIKE ? OR p.sku LIKE ? OR l.code LIKE ? OR rm.name LIKE ?)",
    );
    args.push(...Array(4).fill(`%${f.q}%`));
  }
  if (f.category_id) {
    where.push("p.category_id=?");
    args.push(f.category_id);
  }
  if (f.location_id) {
    where.push("p.location_id=?");
    args.push(f.location_id);
  }
  if (f.room_id) {
    where.push("rm.id=?");
    args.push(f.room_id);
  }
  if (f.block_id) {
    where.push("b.id=?");
    args.push(f.block_id);
  }
  if (f.rack_id) {
    where.push("r.id=?");
    args.push(f.rack_id);
  }
  if (f.stock)
    where.push(
      { low: "p.stock<=2", zero: "p.stock=0", safe: "p.stock>2" }[f.stock],
    );
  if (f.sort === "fast") {
    where.push("p.movement_class=?");
    args.push("FAST");
  }
  if (f.sort === "slow") {
    where.push("p.movement_class=?");
    args.push("SLOW");
  }
  if (f.sort === "dead") {
    where.push("p.movement_class=?");
    args.push("DEAD");
  }
  if (f.sort === "unlabelled") where.push("p.movement_class IS NULL");
  const clause = " WHERE " + where.join(" AND ");
  const direction =
    f.direction ?? (["stock", "out_total"].includes(f.sort) ? "desc" : "asc");
  const sorts: Record<string, string> = {
    id: `p.id ${direction}`,
    sku: `p.sku ${direction}`,
    name: `p.name ${direction}`,
    stock: `p.stock ${direction},p.name ASC`,
    out_total: `COALESCE(mv.out_total,0) ${direction},p.name ASC`,
    // Rack and slot numbers are integers: A.02 comes before A.10 and A.100.
    location: `rm.name ${direction},b.code ${direction},r.rack_number ${direction},l.position_number ${direction},p.name ASC`,
    fast: "p.name ASC",
    slow: "p.name ASC",
    dead: "p.name ASC",
    movement:
      "CASE p.movement_class WHEN 'FAST' THEN 0 WHEN 'SLOW' THEN 1 WHEN 'DEAD' THEN 2 ELSE 3 END ASC,p.name ASC",
    unlabelled: "p.name ASC",
  };
  const queryArgs = args;
  const [{ total }] = await rows<{ total: number }>(
    "SELECT COUNT(*) total FROM products p JOIN locations l ON l.id=p.location_id" +
      hierarchyJoins +
      movementJoin +
      clause,
    queryArgs,
  );
  const items = await rows<InventoryProduct>(
    productListSelect.replace(
      "SELECT ",
      "SELECT COALESCE(mv.out_total,0) out_total,",
    ) +
      movementJoin +
      clause +
      ` ORDER BY ${sorts[f.sort]},p.id ASC ${f.export ? "" : `LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`}`,
    queryArgs,
  );
  return {
    items: items.map((p) => ({ ...p, out_total: Number(p.out_total) })),
    total,
    page: f.page,
    limit: f.limit,
  };
}
// Date filters use the same configured timezone as display. Compute midnight offsets via Intl (including DST).
export function dateBoundary(day: string, next = false) {
  const [y, m, d] = day.split("-").map(Number);
  let target = Date.UTC(y, m - 1, d + (next ? 1 : 0));
  let utc = target;
  for (let n = 0; n < 3; n++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: process.env.APP_TIMEZONE || "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utc));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const represented = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    utc += target - represented;
  }
  return new Date(utc).toISOString().slice(0, 19).replace("T", " ");
}
/** `type` null = semua jenis transaksi (tab "Semua" di halaman Riwayat). */
export async function history(
  type: string | null,
  f: Filters,
  reservationsOnly = false,
) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (type) {
    where.push("t.transaction_type=?");
    args.push(type);
  }
  if (reservationsOnly) where.push("t.reservation_number IS NOT NULL");
  if (f.q) {
    where.push(
      "(p.name LIKE ? OR p.sku LIKE ? OR t.location_code LIKE ? OR t.transaction_number LIKE ? OR t.room_name LIKE ? OR t.reservation_number LIKE ?)",
    );
    args.push(...Array(6).fill(`%${f.q}%`));
  }
  if (f.product_id) {
    where.push("t.product_id=?");
    args.push(f.product_id);
  }
  if (f.location_id) {
    where.push("t.location_id=?");
    args.push(f.location_id);
  }
  if (f.status) {
    where.push("t.status=?");
    args.push(f.status);
  }
  if (f.from) {
    where.push("t.scanned_at>=?");
    args.push(dateBoundary(f.from));
  }
  if (f.to) {
    where.push("t.scanned_at<?");
    args.push(dateBoundary(f.to, true));
  }
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  const sorts: Record<Filters["sort"], string> = {
    id: "t.id",
    scanned_at: "t.scanned_at",
    approved_at: "t.approved_at",
    quantity: "t.quantity",
    sku: "p.sku",
  };
  const [{ total }] = await rows<{ total: number }>(
    "SELECT COUNT(*) total FROM stock_transactions t JOIN products p ON p.id=t.product_id" +
      clause,
    args,
  );
  const items = await rows<StockTransaction>(
    transactionSelect +
      clause +
      ` ORDER BY ${sorts[f.sort]} ${f.direction},t.id ${f.export ? "" : `LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`}`,
    args,
  );
  return { items, total, page: f.page, limit: f.limit };
}
export async function dashboard() {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const from = dateBoundary(day),
    to = dateBoundary(day, true);
  const [products] = await rows(
    "SELECT COUNT(*) total_products,COALESCE(SUM(stock),0) total_stock,COALESCE(SUM(stock<=2 AND stock>0),0) low_stock,COALESCE(SUM(stock=0),0) zero_stock FROM products WHERE active=1",
  );
  // Subquery terpisah agar masing-masing memakai index (approved_at, status, scanned_at)
  // dan tidak membaca seluruh histori setiap kali dashboard dimuat ulang.
  const [trans] = await rows(
    `SELECT
      (SELECT COALESCE(SUM(quantity),0) FROM stock_transactions WHERE approved_at>=? AND approved_at<? AND transaction_type='IN' AND status='APPROVED') incoming,
      (SELECT COALESCE(SUM(quantity),0) FROM stock_transactions WHERE approved_at>=? AND approved_at<? AND transaction_type='OUT' AND status='APPROVED') outgoing,
      (SELECT COUNT(*) FROM stock_transactions WHERE status='PENDING') pending,
      (SELECT COUNT(*) FROM stock_transactions WHERE scanned_at>=? AND scanned_at<?) today`,
    [from, to, from, to, from, to],
  );
  return { ...products, ...trans };
}
export function csv(
  items: Record<string, unknown>[],
  columns: string[],
  name: string,
) {
  const cell = (value: unknown) => {
    let s = value == null ? "" : String(value);
    // Angka (mis. selisih adjustment -5) aman; hanya teks berawalan formula yang di-escape.
    if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const body =
    "\uFEFF" +
    [
      columns.map(cell).join(","),
      ...items.map((row) => columns.map((c) => cell(row[c])).join(",")),
    ].join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
