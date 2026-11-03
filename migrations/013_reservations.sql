-- Sesi pengambilan barang per no reservasi (aplikasi HP 1.3.0): user mengisi
-- no reservasi + total item sekali, lalu scan barang satu per satu.
-- Status OPEN (belum selesai) sampai jumlah barang berbeda yang diambil = total_items.
CREATE TABLE reservations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reservation_number CHAR(7) NOT NULL,
  total_items INT UNSIGNED NOT NULL,
  status ENUM('OPEN','DONE') NOT NULL DEFAULT 'OPEN',
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  UNIQUE KEY uq_reservation_number (reservation_number),
  KEY idx_reservations_status (status, created_at),
  CONSTRAINT chk_reservations_total CHECK (total_items BETWEEN 1 AND 999),
  CONSTRAINT chk_reservations_number CHECK (CHAR_LENGTH(reservation_number) = 7),
  CONSTRAINT fk_reservations_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Barang keluar yang diambil lewat sesi reservasi (NULL = transaksi lama / buku darurat).
ALTER TABLE stock_transactions
  ADD COLUMN reservation_id INT UNSIGNED NULL AFTER reservation_number,
  ADD KEY idx_transactions_reservation_product (reservation_id, product_id),
  ADD CONSTRAINT fk_transactions_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id);
