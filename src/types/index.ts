export interface Product {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  category_name: string;
  movement_class: "FAST" | "SLOW" | "DEAD" | null;
  unit: string;
  stock: number;
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
  image: string | null;
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
  actor_name: string | null;
  name: string;
  sku: string;
  unit: string;
  stock: number;
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

// Baris daftar barang: tanpa foto agar respons tetap kecil.
export interface InventoryProduct extends Omit<Product, "image"> {
  out_total: number;
}
