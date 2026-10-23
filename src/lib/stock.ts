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
/** Koreksi stok: kurangi (rusak/hilang), tambah (ditemukan), atau isi stok fisik. */
export type CorrectionMode = "reduce" | "add" | "set";
export function correction(
  stock: number,
  mode: CorrectionMode,
  amount: number,
  unit: string | null | undefined,
): { after: number; delta: number } | { error: string } {
  if (!validAmount(amount, unit) || amount < 0 || (mode !== "set" && amount === 0))
    return {
      error: allowsDecimal(unit)
        ? "Isi jumlah lebih dari 0 (maks. 3 angka di belakang koma)."
        : "Isi jumlah bilangan bulat lebih dari 0.",
    };
  if (mode === "reduce" && amount > stock)
    return { error: `Tidak bisa mengurangi lebih dari stok sistem (${stock}).` };
  const after =
    mode === "set"
      ? amount
      : roundStock(mode === "add" ? stock + amount : stock - amount);
  if (after > MAX_QUANTITY) return { error: "Stok melampaui batas sistem." };
  if (after === stock) return { error: "Stok baru sama dengan stok sistem." };
  return { after, delta: roundStock(after - stock) };
}
export function stockLabel(stock: number) {
  return stock === 0 ? "STOK HABIS" : stock <= 2 ? "STOK MENIPIS" : "AMAN";
}
