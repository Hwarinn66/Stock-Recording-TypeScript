import type { PoolConnection } from "mysql2/promise";
import {
  RESERVATION,
  batchHistory,
  batchHistoryDetail,
  batchProgress,
  claimBatchItem,
  createBatch,
  getBatch,
  refreshBatch,
  setBatchTotal,
} from "./scan-batches";

// Sesi pengambilan barang keluar per no reservasi (aplikasi HP): no reservasi + total
// item sekali, lalu scan barang satu per satu (lihat scan-batches.ts).
export const getReservation = (number: string) => getBatch(RESERVATION, number);

export const createReservation = (
  input: { reservation_number: string; total_items: number },
  userId: number,
) =>
  createBatch(
    RESERVATION,
    { code: input.reservation_number, total_items: input.total_items },
    userId,
  );

export const setReservationTotal = (number: string, total: number) =>
  setBatchTotal(RESERVATION, number, total);

export const refreshReservation = (id: number, conn: PoolConnection) =>
  refreshBatch(RESERVATION, id, conn);

export const reservationProgress = (id: number) => batchProgress(RESERVATION, id);

export const claimReservationItem = (
  conn: PoolConnection,
  input: {
    reservation_number: string;
    total_items: number;
    product_id: number;
    userId: number;
    at: Date | null;
  },
) =>
  claimBatchItem(RESERVATION, conn, {
    code: input.reservation_number,
    total_items: input.total_items,
    product_id: input.product_id,
    userId: input.userId,
    at: input.at,
  });

/** Riwayat reservasi di dashboard: per no reservasi, termasuk barang keluar tanpa sesi. */
export const reservationHistory = (f: {
  q?: string;
  status?: "OPEN" | "DONE";
  page: number;
  limit: number;
}) => batchHistory(RESERVATION, f);

export const reservationHistoryDetail = (number: string) =>
  batchHistoryDetail(RESERVATION, number);
