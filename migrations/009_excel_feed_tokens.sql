-- Kunci akses baca-saja untuk file "Excel live" yang diunduh dari web: Excel di PC
-- mana pun mengambil data stok dari web dengan kunci ini. Yang disimpan hanya hash.
CREATE TABLE excel_feed_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
