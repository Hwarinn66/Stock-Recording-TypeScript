-- Kunci pengiriman unik dari aplikasi HP (UUID) dan buku darurat Excel.
-- Transaksi yang dikirim ulang (sinyal putus, antrean offline, unggah ulang file)
-- dengan kunci yang sama tidak dicatat dua kali. Data lama tetap NULL.
ALTER TABLE stock_transactions
  ADD COLUMN client_ref VARCHAR(64) NULL AFTER reservation_number,
  ADD UNIQUE KEY uq_client_ref (client_ref);
