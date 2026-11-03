import { z } from "zod";
import { rows } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { dateBoundary, localDay } from "@/lib/time";
import { opnameSchema } from "@/validators";
import { hierarchyJoins } from "./locations";
import type { OpnameRow } from "@/types";

type Filters = z.infer<typeof opnameSchema>;

// Opname harian per barang pada satu tanggal (jam dinding zona aplikasi, default WIB):
// Stok akhir = stok sekarang dikurangi perubahan stok setelah tanggal itu; Stok awal = stok akhir
// dikurangi perubahan pada tanggal itu. Hanya transaksi selesai (APPROVED) yang mengubah
// stok, dihitung menurut waktu kejadian (approved_at; antrean offline & buku darurat
// memakai waktu aslinya), sama seperti IN/OUT hari ini di dashboard.
const change =
  "CASE t.transaction_type WHEN 'IN' THEN t.quantity WHEN 'OUT' THEN -t.quantity ELSE t.stock_after-t.stock_before END";
const joins = ` FROM products p JOIN categories c ON c.id=p.category_id JOIN locations l ON l.id=p.location_id${hierarchyJoins}
  LEFT JOIN (
    SELECT t.product_id,
      SUM(CASE WHEN t.transaction_type='IN' THEN t.quantity ELSE 0 END) incoming,
      SUM(CASE WHEN t.transaction_type='OUT' THEN t.quantity ELSE 0 END) outgoing,
      SUM(CASE WHEN t.transaction_type='ADJUSTMENT' THEN t.stock_after-t.stock_before ELSE 0 END) adjustment,
      COUNT(*) transactions
    FROM stock_transactions t WHERE t.status='APPROVED' AND t.approved_at>=? AND t.approved_at<?
    GROUP BY t.product_id
  ) d ON d.product_id=p.id
  LEFT JOIN (
    SELECT t.product_id,SUM(${change}) later
    FROM stock_transactions t WHERE t.status='APPROVED' AND t.approved_at>=?
    GROUP BY t.product_id
  ) a ON a.product_id=p.id`;
const closing = "(p.stock-COALESCE(a.later,0))";

export async function opname(f: Filters) {
  const day = f.date ?? localDay();
  if (day > localDay())
    throw new AppError(
      "INVALID_DATE",
      "Tanggal opname tidak boleh setelah hari ini.",
      422,
    );
  const from = dateBoundary(day),
    to = dateBoundary(day, true);
  // Default: barang yang ada transaksi pada tanggal itu (termasuk yang sudah nonaktif).
  const where = [
    f.all === "1"
      ? "(p.active=1 OR d.product_id IS NOT NULL)"
      : "d.product_id IS NOT NULL",
  ];
  const args: unknown[] = [from, to, to];
  if (f.q) {
    where.push("(p.name LIKE ? OR p.sku LIKE ? OR l.code LIKE ?)");
    args.push(...Array(3).fill(`%${f.q}%`));
  }
  if (f.category_id) {
    where.push("p.category_id=?");
    args.push(f.category_id);
  }
  if (f.block_id) {
    where.push("b.id=?");
    args.push(f.block_id);
  }
  const clause = " WHERE " + where.join(" AND ");
  const sorts: Record<Filters["sort"], string> = {
    // Urut lokasi = urutan berjalan di gudang saat menghitung fisik.
    location: "rm.name,b.code,r.rack_number,l.position_number,p.name",
    name: "p.name,p.sku",
    outgoing: "COALESCE(d.outgoing,0) DESC,p.name",
  };
  const [summary] = await rows<{
    total: number;
    moved: number;
    outgoing_items: number;
    incoming_items: number;
  }>(
    `SELECT COUNT(*) total,COALESCE(SUM(d.product_id IS NOT NULL),0) moved,COALESCE(SUM(d.outgoing>0),0) outgoing_items,COALESCE(SUM(d.incoming>0),0) incoming_items` +
      joins +
      clause,
    args,
  );
  const items = await rows<OpnameRow>(
    `SELECT p.id,p.sku,p.name,p.unit,p.min_stock,p.active,c.name category_name,l.code location_code,b.code block_code,rm.name room_name,
      ${closing}-COALESCE(d.incoming,0)+COALESCE(d.outgoing,0)-COALESCE(d.adjustment,0) opening,
      COALESCE(d.incoming,0) incoming,COALESCE(d.outgoing,0) outgoing,COALESCE(d.adjustment,0) adjustment,
      ${closing} closing,COALESCE(d.transactions,0) transactions` +
      joins +
      clause +
      ` ORDER BY ${sorts[f.sort]},p.id ${f.export ? "" : `LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`}`,
    args,
  );
  return {
    date: day,
    items: items.map((i) => ({
      ...i,
      opening: Number(i.opening),
      incoming: Number(i.incoming),
      outgoing: Number(i.outgoing),
      adjustment: Number(i.adjustment),
      closing: Number(i.closing),
      transactions: Number(i.transactions),
    })),
    total: Number(summary.total),
    moved: Number(summary.moved),
    outgoing_items: Number(summary.outgoing_items),
    incoming_items: Number(summary.incoming_items),
    page: f.page,
    limit: f.limit,
  };
}
