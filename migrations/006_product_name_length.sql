-- Nama barang dari ekspor ERP bisa lebih dari 160 karakter (mis. spesifikasi wire rope).
-- Jalankan SEKALI pada database yang sudah ada. Data lama tidak berubah.
ALTER TABLE products MODIFY name VARCHAR(255) NOT NULL;
