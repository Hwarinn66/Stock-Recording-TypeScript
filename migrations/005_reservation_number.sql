-- Nomor reservasi 7 angka untuk barang keluar (OUT) dari aplikasi scanner HP.
-- Jalankan SEKALI pada database yang sudah ada. Pilih warehouse_stock terlebih dahulu.
-- Hanya menambah kolom NULL + index; data lama tidak berubah.
ALTER TABLE stock_transactions
  ADD COLUMN reservation_number CHAR(7) NULL AFTER notes,
  ADD CHECK (reservation_number IS NULL OR CHAR_LENGTH(reservation_number) = 7),
  ADD INDEX idx_transactions_reservation(reservation_number);
