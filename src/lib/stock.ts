import { AppError } from "./errors";
export const MAX_QUANTITY = 2147483647;
export const STOCK_DECIMALS = 3;
/** Barang satuan Kg boleh berkoma (mis. 548,8 Kg); satuan lain bilangan bulat. */
export function allowsDecimal(unit: string | null | undefined) {
  return (unit ?? "").replace(/\s+/g, "").toLowerCase() === "kg";
}
/** Hilangkan galat floating point (0.1+0.2) sesuai presisi kolom DECIMAL(15,3). */
export function roundStock(value: number) {
  return Math.round(value * 10 ** STOCK_DECIMALS) / 10 ** STOCK_DECIMALS;
}
/** Jumlah sah untuk satuan ini: bulat, atau maks. 3 desimal bila satuan Kg. */
export function validAmount(value: number, unit: string | null | undefined) {
  if (!Number.isFinite(value)) return false;
  return allowsDecimal(unit)
    ? Math.abs(value - roundStock(value)) < 1e-9
    : Number.isInteger(value);
}
export function calculateStock(
  stock: number,
  quantity: number,
  type: "IN" | "OUT",
  unit = "Pcs",
) {
  if (!validAmount(quantity, unit) || quantity <= 0 || quantity > MAX_QUANTITY)
    throw new AppError(
      "INVALID_QUANTITY",
      allowsDecimal(unit)
        ? "Quantity harus lebih besar dari 0 (maks. 3 angka di belakang koma)."
        : "Quantity harus bilangan bulat lebih besar dari 0.",
    );
  if (type === "OUT" && stock < quantity)
    throw new AppError(
      "STOCK_NOT_ENOUGH",
      `Stok tidak mencukupi. Stok tersedia: ${stock}. Quantity keluar: ${quantity}.`,
      409,
      { stock, quantity },
    );
  const after = roundStock(type === "IN" ? stock + quantity : stock - quantity);
  if (after > MAX_QUANTITY)
    throw new AppError("STOCK_OVERFLOW", "Stok melampaui batas sistem.");
  return after;
}
/**
 * Koreksi stok: user mengisi jumlah sebenarnya di gudang, selisih dihitung
 * otomatis (mis. web 10, gudang 8 → selisih -2). `same` = belum ada perubahan.
 */
export function correction(
  stock: number,
  actual: number,
  unit: string | null | undefined,
): { after: number; delta: number } | { error: string; same?: boolean } {
  if (!validAmount(actual, unit) || actual < 0)
    return {
      error: allowsDecimal(unit)
        ? "Isi jumlah 0 atau lebih (maks. 3 angka di belakang koma)."
        : "Isi jumlah bilangan bulat 0 atau lebih.",
    };
  if (actual > MAX_QUANTITY) return { error: "Jumlah melampaui batas sistem." };
  const after = roundStock(actual);
  if (after === stock)
    return { error: "Jumlah sama dengan stok di web.", same: true };
  return { after, delta: roundStock(after - stock) };
}
export function stockLabel(stock: number) {
  return stock === 0 ? "STOK HABIS" : stock <= 2 ? "STOK MENIPIS" : "AMAN";
}
