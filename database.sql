-- MySQL >= 8.0.16 / MariaDB >= 10.6, InnoDB. Import sekali ke database baru.
CREATE DATABASE IF NOT EXISTS warehouse_stock CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE warehouse_stock;
SET time_zone = '+00:00';
CREATE TABLE users (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(100) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id INT UNSIGNED NOT NULL, expires_at DATETIME(3) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, INDEX(expires_at)
) ENGINE=InnoDB;
-- Kunci akses baca-saja untuk file Excel live (hanya hash yang disimpan).
CREATE TABLE excel_feed_tokens (
 token_hash CHAR(64) PRIMARY KEY, user_id INT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), last_used_at DATETIME(3) NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE login_attempts (
 identity_hash CHAR(64) PRIMARY KEY, attempts INT UNSIGNED NOT NULL DEFAULT 0,
 window_start DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE categories (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE rooms (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE blocks (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, room_id INT UNSIGNED NOT NULL,
 code VARCHAR(20) NOT NULL, name VARCHAR(100) NOT NULL,
 UNIQUE KEY uq_block_code(room_id,code),
 FOREIGN KEY(room_id) REFERENCES rooms(id),
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE racks (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, block_id INT UNSIGNED NOT NULL,
 rack_number INT UNSIGNED NOT NULL, name VARCHAR(100) NOT NULL,
 UNIQUE KEY uq_rack_number(block_id,rack_number), CHECK(rack_number>0),
 FOREIGN KEY(block_id) REFERENCES blocks(id),
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE locations (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, rack_id INT UNSIGNED NOT NULL,
 position_number INT UNSIGNED NOT NULL, code VARCHAR(50) NOT NULL,
 name VARCHAR(100) NOT NULL, description TEXT, active BOOLEAN NOT NULL DEFAULT 1,
 legacy_code VARCHAR(50) NULL,
 UNIQUE KEY uq_rack_position(rack_id,position_number), CHECK(position_number>0),
 FOREIGN KEY(rack_id) REFERENCES racks(id),
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE products (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sku VARCHAR(64) NOT NULL UNIQUE,
 name VARCHAR(255) NOT NULL, category_id INT UNSIGNED NOT NULL, unit VARCHAR(20) NOT NULL,
 movement_class ENUM('FAST','SLOW','DEAD') NULL DEFAULT NULL,
 -- DECIMAL: barang satuan Kg boleh berkoma; satuan lain dijaga bilangan bulat oleh aplikasi.
 stock DECIMAL(15,3) NOT NULL DEFAULT 0, location_id INT UNSIGNED NOT NULL,
 qr_token CHAR(36) NOT NULL UNIQUE, image MEDIUMTEXT, description TEXT,
 active BOOLEAN NOT NULL DEFAULT 1,
 active_location_id INT UNSIGNED GENERATED ALWAYS AS (CASE WHEN active=1 THEN location_id ELSE NULL END) STORED,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_active_location (active_location_id), CHECK(stock >= 0),
 FOREIGN KEY(category_id) REFERENCES categories(id), FOREIGN KEY(location_id) REFERENCES locations(id)
) ENGINE=InnoDB;
CREATE TABLE transaction_sequences (
 sequence_date DATE NOT NULL, kind VARCHAR(3) NOT NULL, last_number INT UNSIGNED NOT NULL,
 PRIMARY KEY(sequence_date,kind)
) ENGINE=InnoDB;
CREATE TABLE stock_transactions (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, transaction_number VARCHAR(40) NOT NULL UNIQUE,
 product_id INT UNSIGNED NOT NULL, location_id INT UNSIGNED NOT NULL,
 -- Snapshot kode rak agar perubahan nama/kode rak tidak mengubah histori.
 location_code VARCHAR(50) NOT NULL, room_name VARCHAR(100) NULL,
 transaction_type ENUM('IN','OUT','ADJUSTMENT') NOT NULL,
 quantity DECIMAL(15,3) NULL, stock_before DECIMAL(15,3) NULL, stock_after DECIMAL(15,3) NULL,
 status ENUM('PENDING','APPROVED','CANCELLED') NOT NULL DEFAULT 'PENDING', notes TEXT,
 -- Nomor reservasi 7 angka: identitas pengambilan & divisi untuk barang keluar.
 reservation_number CHAR(7) NULL,
 -- Kunci pengiriman unik (UUID aplikasi HP / baris buku darurat): kirim ulang tidak tercatat dua kali.
 client_ref VARCHAR(64) NULL,
 actor_id INT UNSIGNED NOT NULL,
 pending_product_id INT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status='PENDING' THEN product_id ELSE NULL END) STORED,
 scanned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), approved_at DATETIME(3), cancelled_at DATETIME(3),
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_pending_product(pending_product_id), UNIQUE KEY uq_client_ref(client_ref),
 FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(location_id) REFERENCES locations(id),
 FOREIGN KEY(actor_id) REFERENCES users(id),
 CHECK (stock_before IS NULL OR stock_before >= 0), CHECK(stock_after IS NULL OR stock_after >= 0),
 CHECK(transaction_type='ADJUSTMENT' OR quantity IS NULL OR quantity > 0),
 CHECK(reservation_number IS NULL OR CHAR_LENGTH(reservation_number) = 7),
 CHECK(status <> 'APPROVED' OR (quantity IS NOT NULL AND stock_before IS NOT NULL AND stock_after IS NOT NULL AND approved_at IS NOT NULL))
) ENGINE=InnoDB;
CREATE INDEX idx_locations_code ON locations(code);
CREATE INDEX idx_products_location ON products(location_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_movement_name ON products(movement_class,name);
CREATE INDEX idx_transactions_product ON stock_transactions(product_id);
CREATE INDEX idx_transactions_status ON stock_transactions(status);
CREATE INDEX idx_transactions_type ON stock_transactions(transaction_type);
CREATE INDEX idx_transactions_scanned ON stock_transactions(scanned_at);
CREATE INDEX idx_transactions_approved ON stock_transactions(approved_at);
CREATE INDEX idx_transactions_reservation ON stock_transactions(reservation_number);
-- Transactional outbox: SSE hanya membaca perubahan yang telah COMMIT.
CREATE TABLE stock_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, event_type VARCHAR(40) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
INSERT INTO categories(name) VALUES ('Elektronik'),('Kabel'),('ATK'),('Sparepart');
INSERT INTO rooms(name) VALUES
 ('Ruangan 1'),('Ruangan 2'),('Ruangan 3'),('Ruangan 4'),('Ruangan 5');
INSERT INTO blocks(room_id,code,name)
 SELECT rm.id,c.code,CONCAT('Blok ',c.code)
 FROM rooms rm
 CROSS JOIN (SELECT 'A' code UNION ALL SELECT 'B' UNION ALL SELECT 'C' UNION ALL SELECT 'D') c
 WHERE rm.name IN ('Ruangan 1','Ruangan 2','Ruangan 3','Ruangan 4','Ruangan 5');
INSERT INTO racks(block_id,rack_number,name)
 SELECT b.id,n.n,CONCAT('Rak ',b.code,'.',LPAD(n.n,2,'0'))
 FROM blocks b
 JOIN rooms rm ON rm.id=b.room_id
 CROSS JOIN (SELECT 1 n UNION ALL SELECT 2 n UNION ALL SELECT 3 n UNION ALL SELECT 4 n UNION ALL SELECT 5 n UNION ALL SELECT 6 n UNION ALL SELECT 7 n UNION ALL SELECT 8 n UNION ALL SELECT 9 n UNION ALL SELECT 10 n UNION ALL SELECT 11 n UNION ALL SELECT 12 n UNION ALL SELECT 13 n UNION ALL SELECT 14 n UNION ALL SELECT 15 n UNION ALL SELECT 16 n UNION ALL SELECT 17 n UNION ALL SELECT 18 n UNION ALL SELECT 19 n UNION ALL SELECT 20 n UNION ALL SELECT 21 n UNION ALL SELECT 22 n UNION ALL SELECT 23 n UNION ALL SELECT 24 n UNION ALL SELECT 25 n) n
 WHERE rm.name IN ('Ruangan 1','Ruangan 2','Ruangan 3','Ruangan 4','Ruangan 5')
   AND b.code IN ('A','B','C','D');
-- Posisi barang sengaja tidak dibuat otomatis. Buat hanya nomor posisi yang benar-benar dipakai.
-- Tidak ada barang contoh. Isi data barang sendiri melalui aplikasi.
-- Tidak ada password default. Buat akun dengan npm run user:create -- admin "PASSWORD-ANDA".
