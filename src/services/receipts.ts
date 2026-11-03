import {
  RECEIPT,
  batchHistory,
  batchHistoryDetail,
  createBatch,
  getBatch,
  setBatchTotal,
} from "./scan-batches";

// Sesi penerimaan barang masuk per Kode Masuk (aplikasi HP): kode masuk (111.22.33, barang
// ATK: ATK.111.22.33) + total item sekali, lalu scan barang satu per satu. Satu kode masuk
// hanya untuk barang ATK atau hanya barang bukan ATK (lihat scan-batches.ts).
export const getReceipt = (code: string) => getBatch(RECEIPT, code);

export const createReceipt = (
  input: { in_code: string; total_items: number },
  userId: number,
) => createBatch(RECEIPT, { code: input.in_code, total_items: input.total_items }, userId);

export const setReceiptTotal = (code: string, total: number) =>
  setBatchTotal(RECEIPT, code, total);

/** Riwayat penerimaan di dashboard: per kode masuk, termasuk barang masuk tanpa sesi. */
export const receiptHistory = (f: {
  q?: string;
  status?: "OPEN" | "DONE";
  page: number;
  limit: number;
}) => batchHistory(RECEIPT, f);

export const receiptHistoryDetail = (code: string) => batchHistoryDetail(RECEIPT, code);
