export interface Product {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  category_name: string;
  movement_class: "FAST" | "SLOW" | "DEAD" | null;
  unit: string;
  stock: number;
  /** Batas stok minimal: stok <= min_stock = STOK MENIPIS. */
  min_stock: number;
  location_id: number;
  location_code: string;
  room_name: string | null;
  room_id: number;
  block_id: number;
  block_code: string;
  rack_id: number;
  rack_number: number;
  position_number: number;
  qr_token: string;
  description: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}
export interface StockTransaction {
  id: number;
  transaction_number: string;
  product_id: number;
  location_id: number;
  location_code: string;
  room_name: string | null;
  transaction_type: "IN" | "OUT" | "ADJUSTMENT";
  quantity: number | null;
  stock_before: number | null;
  stock_after: number | null;
  status: "PENDING" | "APPROVED" | "CANCELLED";
  scanned_at: string;
  approved_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  reservation_number: string | null;
  /** Sesi reservasi HP tempat barang ini diambil (NULL = transaksi lama / buku darurat). */
  reservation_id?: number | null;
  in_code?: string | null;
  /** Sesi kode masuk HP tempat barang ini diterima (NULL = transaksi lama / buku darurat). */
  receipt_id?: number | null;
  client_ref?: string | null;
  actor_name: string | null;
  name: string;
  sku: string;
  unit: string;
  stock: number;
}
/**
 * Sesi scan HP: pengambilan barang keluar per no reservasi, atau penerimaan barang masuk
 * per kode masuk. `code` = no reservasi / kode masuk.
 */
export interface Batch {
  id: number;
  code: string;
  reservation_number?: string;
  in_code?: string;
  /** Jumlah jenis barang yang harus diambil / masuk. */
  total_items: number;
  /** Jumlah jenis barang yang sudah diambil / masuk. */
  taken: number;
  status: "OPEN" | "DONE";
  created_by_name: string | null;
  created_at: string;
  completed_at: string | null;
  last_activity: string | null;
}
/** Satu baris riwayat reservasi / penerimaan di dashboard (field sesi null = data lama tanpa sesi). */
export interface BatchHistoryRow {
  code: string;
  reservation_number?: string;
  in_code?: string;
  /** Jumlah jenis barang yang sudah diambil / masuk dengan kode ini. */
  item_count: number;
  last_scan: string | null;
  actors: string | null;
  total_items: number | null;
  taken: number | null;
  status: "OPEN" | "DONE" | null;
  created_at: string | null;
  completed_at: string | null;
}
export interface BatchItem {
  id: number;
  transaction_number: string;
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  location_code: string;
  scanned_at: string;
  actor_name: string | null;
  /** false = transaksi lama / dari luar sesi HP (aplikasi lama, buku darurat). */
  in_session?: boolean;
}
export interface Lookup {
  id: number;
  name: string;
  code?: string;
  active?: number;
  description?: string;
}

export interface LocationLookup extends Lookup {
  room_id?: number;
  room_name?: string;
  block_id?: number;
  block_code?: string;
  rack_id?: number;
  rack_number?: number;
  position_number?: number;
  product_id?: number | null;
  product_name?: string | null;
  legacy_code?: string | null;
}

// Baris daftar barang + total barang keluar.
export interface InventoryProduct extends Product {
  out_total: number;
}
