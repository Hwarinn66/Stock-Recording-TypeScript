-- Fitur foto barang dihapus dari web & aplikasi HP. Kolom foto dibuang.
-- Jalankan SETELAH source baru aktif (source lama masih memakai kolom ini).
-- Sebelum dibuang dicek: 0 barang berfoto di database lokal & Aiven (27 Okt 2026).
ALTER TABLE products DROP COLUMN image;
