import { z } from "zod";
import { rows } from "@/lib/db";
import { labelSheetPdf, labelsPdf } from "@/lib/label-pdf";
import { labelListSchema, labelPdfSchema, MAX_LABELS } from "@/validators";
import { hierarchyJoins } from "./locations";
import type { LabelCandidate } from "@/types";

// Print QR massal: label 35 x 35 mm untuk banyak barang sekaligus, dipilih lewat filter
// (blok, rak, kategori, Fast/Slow moving) lalu dicentang satu per satu.
const select = `SELECT p.id,p.sku,p.name,p.qr_token,p.movement_class,c.name category_name,l.code location_code,b.code block_code,r.rack_number
  FROM products p JOIN categories c ON c.id=p.category_id JOIN locations l ON l.id=p.location_id${hierarchyJoins}`;
// Urut lokasi: label tercetak sesuai urutan rak di gudang.
const order = " ORDER BY rm.name,b.code,r.rack_number,l.position_number,p.sku,p.id";

/** Barang aktif yang cocok dengan filter (maks. MAX_LABELS) + jumlah seluruhnya. */
export async function labelCandidates(f: z.infer<typeof labelListSchema>) {
  const where = ["p.active=1"];
  const args: unknown[] = [];
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
  if (f.rack_id) {
    where.push("r.id=?");
    args.push(f.rack_id);
  }
  if (f.movement === "NONE") where.push("p.movement_class IS NULL");
  else if (f.movement) {
    where.push("p.movement_class=?");
    args.push(f.movement);
  }
  const clause = " WHERE " + where.join(" AND ");
  const [{ total }] = await rows<{ total: number }>(
    `SELECT COUNT(*) total FROM (${select}${clause}) x`,
    args,
  );
  const items = await rows<LabelCandidate & { qr_token?: string }>(
    select + clause + order + ` LIMIT ${MAX_LABELS}`,
    args,
  );
  // QR token tidak dikirim ke browser; PDF dibuat di server.
  return {
    items: items.map(({ qr_token: _, ...item }) => item),
    total: Number(total),
    limit: MAX_LABELS,
  };
}

/** PDF label barang terpilih, urut lokasi. */
export async function labelsPdfFor(input: z.infer<typeof labelPdfSchema>) {
  const items = await rows<LabelCandidate & { qr_token: string }>(
    select + ` WHERE p.id IN (${input.ids.map(() => "?").join(",")})` + order,
    input.ids,
  );
  const labels = items.map((p) => ({
    qrToken: p.qr_token,
    sku: p.sku,
    note: input.location === "1" ? `Blok ${p.block_code} - ${p.location_code}` : undefined,
  }));
  return {
    count: labels.length,
    pdf: input.layout === "roll" ? labelsPdf(labels) : labelSheetPdf(labels),
  };
}
