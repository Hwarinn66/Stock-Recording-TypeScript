-- Sesi penerimaan barang masuk per Kode Masuk (aplikasi HP 1.4.0): user mengisi kode masuk
-- (111.22.33; barang ATK: ATK.111.22.33) + total item sekali, lalu scan barang satu per satu.
-- Status OPEN (belum selesai) sampai jumlah barang berbeda yang masuk = total_items.
CREATE TABLE receipts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  in_code VARCHAR(20) NOT NULL,
  total_items INT UNSIGNED NOT NULL,
  status ENUM('OPEN','DONE') NOT NULL DEFAULT 'OPEN',
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  UNIQUE KEY uq_receipt_code (in_code),
  KEY idx_receipts_status (status, created_at),
  CONSTRAINT chk_receipts_total CHECK (total_items BETWEEN 1 AND 999),
  CONSTRAINT fk_receipts_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Barang masuk yang diterima lewat sesi kode masuk (NULL = transaksi lama / buku darurat).
ALTER TABLE stock_transactions
  ADD COLUMN receipt_id INT UNSIGNED NULL AFTER in_code,
  ADD KEY idx_transactions_receipt_product (receipt_id, product_id),
  ADD KEY idx_transactions_in_code (in_code),
  ADD CONSTRAINT fk_transactions_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id);
