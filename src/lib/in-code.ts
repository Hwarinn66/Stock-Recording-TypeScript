// Kode Masuk: wajib untuk barang masuk (IN) dari aplikasi HP.
// Format 111.22.33 (3 angka . 2 angka . 2 angka); barang kategori ATK diawali "ATK.".
export const isAtkCategory = (name: string | null | undefined) =>
  (name ?? "").trim().toUpperCase() === "ATK";
export function validInCode(code: string, atk: boolean) {
  return (atk ? /^ATK\.\d{3}\.\d{2}\.\d{2}$/ : /^\d{3}\.\d{2}\.\d{2}$/).test(
    code,
  );
}
export const inCodeExample = (atk: boolean) =>
  atk ? "ATK.111.22.33" : "111.22.33";
