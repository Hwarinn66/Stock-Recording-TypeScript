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
  client_ref?: string | null;
  actor_name: string | null;
  name: string;
  sku: string;
  unit: string;
  stock: number;
}
/** Sesi pengambilan barang per no reservasi (aplikasi HP). */
export interface Reservation {
  id: number;
  reservation_number: string;
  /** Jumlah jenis barang yang harus diambil. */
  total_items: number;
  /** Jumlah jenis barang yang sudah diambil. */
  taken: number;
  status: "OPEN" | "DONE";
  created_by_name: string | null;
  created_at: string;
  completed_at: string | null;
  last_activity: string | null;
}
/** Satu baris riwayat reservasi di dashboard (field sesi null = reservasi lama tanpa sesi). */
export interface ReservationHistoryRow {
  reservation_number: string;
  /** Jumlah jenis barang yang sudah diambil dengan no reservasi ini. */
  item_count: number;
  last_scan: string | null;
  actors: string | null;
  total_items: number | null;
  taken: number | null;
  status: "OPEN" | "DONE" | null;
  created_at: string | null;
  completed_at: string | null;
}
export interface ReservationItem {
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
  /** Detail dashboard: false = barang keluar lama / dari luar sesi reservasi HP. */
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
