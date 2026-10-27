import { listLocations, mutateLocation } from "@/services/locations";
import { z } from "zod";
import QRCode from "qrcode";
import { ok, errorResponse, AppError } from "@/lib/errors";
import { checkOrigin, requireUser, login, logout } from "@/lib/auth";
import { rows } from "@/lib/db";
import * as schemas from "@/validators";
import * as stock from "@/services/transactions";
import * as products from "@/services/products";
import { listProducts, history, dashboard, csv } from "@/services/reports";
import { mutateLookup } from "@/services/lookups";
import { backupWorkbookBuffer } from "@/services/excel-backup";
import {
  emergencyTemplateBuffer,
  importEmergency,
  readEmergencyBook,
} from "@/services/emergency";
import { xlsxResponse } from "@/lib/excel";
import { localDay } from "@/lib/time";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handler(req: Request, { params }: Context) {
  try {
    const path = (await params).path;
    const [resource, key, action] = path;
    const method = req.method;
    const url = new URL(req.url);
    if (method !== "GET") checkOrigin(req);
    const body = async () => {
      if (Number(req.headers.get("content-length") || 0) > 2000000)
        throw new AppError("TOO_LARGE", "Foto terlalu besar.", 413);
      const text = await req.text();
      if (text.length > 2000000)
        throw new AppError("TOO_LARGE", "Foto terlalu besar.", 413);
      return JSON.parse(text || "{}");
    };
    if (resource === "auth" && key === "login" && method === "POST") {
      const input = schemas.loginSchema.parse(await body());
      await login(input.username, input.password);
      return ok(null, "Login berhasil");
    }
    const user = await requireUser();
    if (resource === "auth" && key === "logout" && method === "POST") {
      await logout();
      return ok();
    }
    if (resource === "auth" && key === "me" && method === "GET")
      return ok(user);
    const filter = () =>
      schemas.listSchema.parse(Object.fromEntries(url.searchParams));
    // Daftar barang untuk disimpan di HP (scan saat server tidak terjangkau → antrean offline).
    if (resource === "catalog" && !key && method === "GET")
      return ok(await stock.scanCatalog());
    // Cadangan Excel (stok + riwayat) untuk diunduh kapan saja.
    if (resource === "backup" && key === "excel" && method === "GET")
      return xlsxResponse(
        await backupWorkbookBuffer(),
        `stok-gudang-${localDay()}.xlsx`,
      );
    // Buku darurat Excel: unduh template, lalu unggah untuk pratinjau / simpan.
    if (resource === "emergency" && key === "template" && method === "GET")
      return xlsxResponse(
        await emergencyTemplateBuffer(),
        `buku-darurat-${localDay()}.xlsx`,
      );
    if (
      resource === "emergency" &&
      (key === "preview" || key === "apply") &&
      method === "POST"
    ) {
      // Isi file .xlsx dikirim apa adanya (bukan JSON). Batas Vercel ±4,5 MB.
      if (Number(req.headers.get("content-length") || 0) > 4000000)
        throw new AppError(
          "TOO_LARGE",
          "File terlalu besar (maks. 4 MB).",
          413,
        );
      const data = await req.arrayBuffer();
      if (data.byteLength > 4000000)
        throw new AppError(
          "TOO_LARGE",
          "File terlalu besar (maks. 4 MB).",
          413,
        );
      const book = await readEmergencyBook(Buffer.from(data));
      return ok(
        await importEmergency(book, user, { apply: key === "apply" }),
        key === "apply" ? "Buku darurat disimpan" : "Pratinjau buku darurat",
      );
    }
    // Aplikasi scanner HP: cek barang dari QR, lalu kirim jumlah (+ no reservasi untuk OUT).
    if (resource === "scan" && key && method === "GET") {
      const token = schemas.qrTokenSchema.parse(key);
      const { mode } = schemas.lookupSchema.parse(
        Object.fromEntries(url.searchParams),
      );
      return ok(await stock.lookup(token, mode));
    }
    if (resource === "transactions" && !key && method === "POST")
      return ok(
        await stock.record(schemas.recordSchema.parse(await body()), user.id),
        "Transaksi tersimpan. Stok sudah diperbarui.",
      );
    if (resource === "scan" && method === "POST") {
      const input = schemas.scanSchema.parse(await body());
      return ok(
        await stock.scan(input.qr_token, input.mode, user.id),
        "QR berhasil dibaca. Menunggu proses di komputer.",
      );
    }
    if (resource === "pending-transactions" && method === "GET")
      return ok(await stock.pending());
    if (resource === "transactions" && key) {
      const id = schemas.idSchema.parse(key);
      if (action === "quantity" && method === "PATCH") {
        const input = z
          .object({ quantity: schemas.quantitySchema })
          .parse(await body());
        return ok(await stock.setQuantity(id, input.quantity));
      }
      if (action === "approve" && method === "POST") {
        const input = z
          .object({ quantity: schemas.quantitySchema.optional() })
          .parse(await body());
        return ok(
          await stock.approve(id, input.quantity, user.id),
          "Transaksi berhasil di-approve",
        );
      }
      if (action === "cancel" && method === "POST")
        return ok(await stock.cancel(id), "Transaksi dibatalkan");
      if (action === "revise" && method === "PATCH")
        return ok(
          await stock.revise(
            id,
            schemas.reviseSchema.parse(await body()),
            user,
          ),
          "Transaksi direvisi",
        );
    }
    if (resource === "products") {
      if (!key && method === "GET") {
        const f = schemas.productListSchema.parse(
            Object.fromEntries(url.searchParams),
          ),
          result = await listProducts(f);
        return f.export
          ? csv(
              result.items.map((item) => ({
                ...item,
                kode_barang: item.sku,
              })) as unknown as Record<string, unknown>[],
              [
                "kode_barang",
                "name",
                "category_name",
                "stock",
                "unit",
                "location_code",
                "room_name",
                "active",
                "out_total",
                "movement_class",
              ],
              "barang",
            )
          : ok(result);
      }
      if (!key && method === "POST")
        return ok(
          await products.createProduct(
            schemas.productSchema.parse(await body()),
          ),
          "Barang berhasil dibuat",
        );
      const id = schemas.idSchema.parse(key);
      if (action === "qr" && method === "GET") {
        const p = await products.getProduct(id);
        return new Response(
          await QRCode.toString(p.qr_token, {
            type: "svg",
            width: 360,
            margin: 3,
            errorCorrectionLevel: "M",
          }),
          {
            headers: {
              "Content-Type": "image/svg+xml",
              "Cache-Control": "no-store",
            },
          },
        );
      }
      if (action === "qr" && method === "POST")
        return ok(
          await products.regenerate(id),
          "QR diganti. Cetak ulang label.",
        );
      if (!action && method === "GET") return ok(await products.getProduct(id));
      if (!action && method === "PATCH")
        return ok(
          await products.editProduct(
            id,
            schemas.editProductSchema.parse(await body()),
          ),
          "Barang diperbarui",
        );
    }
    if (
      resource === "history" &&
      method === "GET" &&
      ["all", "in", "out", "adjustments", "reservations"].includes(key)
    ) {
      // "reservations" = barang keluar yang memiliki no reservasi; "all" = semua jenis.
      const reservations = key === "reservations";
      const f = filter(),
        type =
          key === "all"
            ? null
            : key === "adjustments"
              ? "ADJUSTMENT"
              : reservations
                ? "OUT"
                : key.toUpperCase(),
        result = await history(type, f, reservations);
      const columns = [
        "transaction_number",
        ...(key === "all" ? ["transaction_type"] : []),
        "scanned_at",
        "approved_at",
        "cancelled_at",
        "kode_barang",
        "name",
        "location_code",
        "room_name",
        "quantity",
        "stock_before",
        "stock_after",
        "status",
        "reservation_number",
        "actor_name",
        "notes",
      ];
      return f.export
        ? csv(
            result.items.map((item) => ({
              ...item,
              kode_barang: item.sku,
            })) as unknown as Record<string, unknown>[],
            reservations
              ? [
                  "reservation_number",
                  ...columns.filter((c) => c !== "reservation_number"),
                ]
              : columns,
            "riwayat-" + key,
          )
        : ok(result);
    }
    if (resource === "adjustments" && method === "POST")
      return ok(
        await stock.adjustment(
          schemas.adjustmentSchema.parse(await body()),
          user.id,
        ),
        "Stock adjustment disimpan",
      );
    if (resource === "dashboard" && method === "GET")
      return ok(await dashboard());
    if (resource === "settings" && method === "GET")
      return ok({
        timezone: process.env.APP_TIMEZONE || "Asia/Jakarta",
        app_url: process.env.APP_URL,
        cookie_secure: process.env.COOKIE_SECURE === "true",
      });
    const masters = {
      rooms: schemas.roomSchema,
      blocks: schemas.blockSchema,
      racks: schemas.rackSchema,
      locations: schemas.locationSchema,
      categories: schemas.categorySchema,
    };
    if (Object.hasOwn(masters, resource)) {
      const kind = resource as keyof typeof masters;
      if (method === "GET" && !key)
        return ok(
          kind === "categories"
            ? await rows("SELECT * FROM categories ORDER BY name")
            : await listLocations(kind),
        );
      if (["POST", "PATCH", "DELETE"].includes(method)) {
        const id = key ? schemas.idSchema.parse(key) : undefined;
        if ((method === "POST" && id) || (method !== "POST" && !id))
          throw new AppError("INVALID_ID", "URL master data tidak sesuai.");
        const input =
          method === "DELETE" ? {} : masters[kind].parse(await body());
        return ok(
          kind === "categories"
            ? await mutateLookup(kind, method, id, input)
            : await mutateLocation(kind, method, id, input),
        );
      }
    }
    throw new AppError("NOT_FOUND", "Endpoint tidak ditemukan.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
