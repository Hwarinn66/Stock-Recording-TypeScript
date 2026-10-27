-- Kode Masuk untuk barang masuk dari aplikasi HP: 111.22.33, barang ATK: ATK.111.22.33.
-- Transaksi lama dan barang keluar tetap NULL.
ALTER TABLE stock_transactions
  ADD COLUMN in_code VARCHAR(20) NULL AFTER reservation_number;
