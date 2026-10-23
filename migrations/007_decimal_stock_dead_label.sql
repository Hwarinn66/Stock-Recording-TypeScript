-- 1) Stok & quantity boleh berkoma (maks. 3 desimal) untuk barang satuan Kg.
--    Aturan per satuan dijaga aplikasi; satuan lain tetap bilangan bulat.
-- 2) Label pergerakan DEAD (dead stock) selain FAST/SLOW.
-- Jalankan SEKALI setelah backup. Nilai lama tidak berubah.
ALTER TABLE products
  MODIFY stock DECIMAL(15,3) NOT NULL DEFAULT 0,
  MODIFY movement_class ENUM('FAST','SLOW','DEAD') NULL DEFAULT NULL;
ALTER TABLE stock_transactions
  MODIFY quantity DECIMAL(15,3) NULL,
  MODIFY stock_before DECIMAL(15,3) NULL,
  MODIFY stock_after DECIMAL(15,3) NULL;
