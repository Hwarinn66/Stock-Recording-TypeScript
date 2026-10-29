-- Batas stok minimal per barang (kolom MIN dari data POSISI gudang).
-- Stok <= min_stock (dan > 0) = STOK MENIPIS. Default 2 = aturan lama (stok 2 atau kurang).
ALTER TABLE products
  ADD COLUMN min_stock DECIMAL(15,3) NOT NULL DEFAULT 2 AFTER stock,
  ADD CONSTRAINT chk_products_min_stock CHECK (min_stock >= 0);
