import { z } from "zod";
import { roundStock } from "@/lib/stock";
export const idSchema = z.coerce.number().int().positive().max(2147483647);
const threeDecimals = (value: number) => Math.abs(value - roundStock(value)) < 1e-9;
// Maks. 3 desimal; aturan bulat untuk satuan selain Kg dicek di service (butuh satuan barang).
export const quantitySchema = z
  .number()
  .positive()
  .max(2147483647)
  .refine(threeDecimals, "Maksimal 3 angka di belakang koma.");
export const movementSchema = z.enum(["FAST", "SLOW", "DEAD"]);
export const qrTokenSchema = z.string().uuid();
export const scanSchema = z.object({
  qr_token: qrTokenSchema,
  mode: z.enum(["IN", "OUT"]),
});
export const reservationSchema = z
  .string()
  .regex(/^\d{7}$/, "No reservasi harus tepat 7 angka.");
export const lookupSchema = z.object({ mode: z.enum(["IN", "OUT"]) });
// Transaksi dari aplikasi scanner HP: stok langsung berubah tanpa approval.
export const recordSchema = z
  .object({
    qr_token: qrTokenSchema,
    mode: z.enum(["IN", "OUT"]),
    quantity: quantitySchema,
    reservation_number: reservationSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "OUT" && !value.reservation_number)
      ctx.addIssue({
        code: "custom",
        path: ["reservation_number"],
        message: "No reservasi wajib untuk barang keluar.",
      });
    if (value.mode === "IN" && value.reservation_number)
      ctx.addIssue({
        code: "custom",
        path: ["reservation_number"],
        message: "No reservasi hanya untuk barang keluar.",
      });
  });
const productBaseSchema = z
  .object({
    sku: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(255),
    category_id: idSchema,
    unit: z.string().trim().min(1).max(20),
    movement_class: movementSchema.nullable().optional(),
    // location_id dipertahankan untuk kompatibilitas API lama.
    location_id: idSchema.optional(),
    rack_id: idSchema.optional(),
    position_number: z.coerce.number().int().min(1).max(999999).optional(),
    description: z.string().max(5000).nullable().optional(),
    image: z
      .string()
      .max(1500000)
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
      .nullable()
      .optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const productSchema = productBaseSchema.superRefine((value, ctx) => {
  const direct = value.rack_id !== undefined || value.position_number !== undefined;
  if (
    value.location_id === undefined &&
    !(value.rack_id !== undefined && value.position_number !== undefined)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["position_number"],
      message: "Pilih rak dan isi nomor penempatan.",
    });
  }
  if (
    direct &&
    (value.rack_id === undefined || value.position_number === undefined)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["position_number"],
      message: "Rak dan nomor penempatan harus diisi bersamaan.",
    });
  }
});

export const editProductSchema = productBaseSchema
  .omit({ sku: true })
  .partial()
  .superRefine((value, ctx) => {
    const direct =
      value.rack_id !== undefined || value.position_number !== undefined;
    if (
      direct &&
      (value.rack_id === undefined || value.position_number === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["position_number"],
        message: "Rak dan nomor penempatan harus diisi bersamaan.",
      });
    }
  });
export const adjustmentSchema = z.object({
  product_id: idSchema,
  physical_stock: z
    .number()
    .min(0)
    .max(2147483647)
    .refine(threeDecimals, "Maksimal 3 angka di belakang koma."),
  expected_stock: z.number().min(0),
  notes: z.string().trim().min(3).max(2000),
});
export const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export const roomSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const blockSchema = z.object({
  room_id: idSchema,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,20}$/),
  name: z.string().trim().min(1).max(100),
});
export const rackSchema = z.object({
  block_id: idSchema,
  rack_number: z.coerce.number().int().min(1).max(999999),
  name: z.string().trim().min(1).max(100),
});
export const locationSchema = z.object({
  rack_id: idSchema,
  position_number: z.coerce.number().int().min(1).max(999999),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});
export const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});
export const listSchema = z.object({
  q: z.string().max(160).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(["id", "scanned_at", "approved_at", "quantity", "sku"])
    .default("id"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  category_id: idSchema.optional(),
  location_id: idSchema.optional(),
  product_id: idSchema.optional(),
  room_id: idSchema.optional(),
  block_id: idSchema.optional(),
  rack_id: idSchema.optional(),
  stock: z.enum(["low", "zero", "safe"]).optional(),
  status: z.enum(["PENDING", "APPROVED", "CANCELLED"]).optional(),
  active: z.enum(["0", "1", "all"]).default("1"),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  export: z.enum(["csv"]).optional(),
});

// Product ordering is independent of history's newest-first default.
export const productListSchema = listSchema.extend({
  sort: z
    .enum([
      "name",
      "sku",
      "id",
      "stock",
      "out_total",
      "location",
      "fast",
      "slow",
      "dead",
      "movement",
      "unlabelled",
    ])
    .default("name"),
  direction: z.enum(["asc", "desc"]).optional(),
});
