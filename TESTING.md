# Hasil verifikasi

## Lulus di lingkungan pengembangan

- Build produksi Next.js 16.3.7, TypeScript strict.
- 9 unit tests: aritmetika IN/OUT, validasi quantity dan overflow, status stok, token QR, penolakan input stock/foto SVG, batas tanggal Asia/Jakarta, CSV formula escaping.
- 14 tests termasuk parent suite pada **MariaDB 10.11.14**, memakai schema `database.sql` yang diimpor ke database test terpisah:
  - Create barang menghasilkan UUID dan stok 0.
  - OUT pada stok 0 ditolak tanpa membuat pending.
  - Scan IN tidak mengubah stok; approve menambah stok.
  - OUT mengurangi stok sesuai quantity.
  - Tiga scan bersamaan IN/OUT untuk barang sama hanya menghasilkan satu pending.
  - Cancel menjaga stok, membuka QR, dan tidak dapat diapprove ulang.
  - OUT melebihi stok ditolak; stok tetap.
  - Stock akhir 2 setelah OUT tervalidasi.
  - Posisi yang sama ditolak; beberapa barang dapat memakai rak yang sama di posisi berbeda.
  - Trigger test menyisipkan error SQL setelah UPDATE stock; perubahan produk dan transaksi keduanya rollback.
  - Dua approve bersamaan hanya mengubah stok satu kali.
  - Adjustment mencatat delta dan menolak stok tampilan yang sudah basi.
  - Pindah rak mempertahankan histori lokasi; regenerasi menolak QR lama; QR barang nonaktif ditolak.
- HTTP smoke test terhadap build produksi + MariaDB: autentikasi, cookie HttpOnly, endpoint terlindungi, Origin/CSRF, Zod, QR SVG, scan, SSE, quantity, approve, histori, CSV, logout/session revocation.

## Batas verifikasi

Browser Chromium pengujian gagal diluncurkan pada sandbox ini. Karena itu pemeriksaan visual browser, interaksi UI otomatis, kamera smartphone, fokus QR cetak, beep/vibrasi, Windows Firewall, dan trust sertifikat HP **belum diverifikasi pada perangkat fisik**. Gunakan checklist penerimaan di README untuk pengujian di komputer Laragon dan HP Anda.

Build sandbox memakai workaround sementara untuk introspeksi RSS Node.js karena `/proc` tidak tersedia. Workaround berada di luar repository, tidak mengubah aplikasi, dan tidak diperlukan pada Windows biasa.

Database pengujian adalah MariaDB Linux, bukan instalasi Laragon Windows Anda. Source tidak memakai SQLite/mock database, Prisma, PostgreSQL, atau layanan database cloud.

## Reproduksi

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:integration` setelah menyiapkan `.env.test` dan database disposable `warehouse_stock_test`.
- `npm run test:http` saat server aplikasi menggunakan database test yang sama. Tambahkan `http://127.0.0.1:3000` ke ALLOWED_ORIGINS. Lihat README untuk detail.

## Verifikasi v2 lokasi bertingkat

- Unit: format A.01.01, A.01.02, A.02.01 dan nomor >99 tanpa pemotongan.
- MariaDB: dua barang aktif pada posisi berbeda dalam satu rak; scan pending kedua barang diperbolehkan; posisi duplikat ditolak; perubahan identitas posisi terpakai diblokir.
- Migrasi v1 → v2 diuji pada database sementara sungguhan, termasuk kode lama tidak standar, alias rak, stok/UUID/ID tetap, dan snapshot transaksi pending lama tidak ditulis ulang.
- Form memilih ruangan/blok/rak/posisi, pengelolaan master, dan label cetak tetap memerlukan pemeriksaan visual di perangkat pengguna sesuai batas verifikasi di atas.

## Verifikasi label manual dan kode barang

Revisi ini menghapus klasifikasi otomatis. Pengujian unit memeriksa FAST/SLOW/NULL tanpa nilai label default. Suite laporan MariaDB memeriksa penyimpanan/perubahan/penghapusan label melalui service, Fast dengan 0 OUT, Slow dengan total OUT tinggi, label yang tidak berubah berdasarkan quantity, grouping A–Z, pagination dan CSV. Dua barang berkapasitas mirip memakai kode a0001/a0002 pada posisi bersebelahan; kode duplikat ditolak dan pencarian kode menemukan varian yang tepat.

Migrasi 003 diuji setelah migrasi 002 pada fixture v1: label lama NULL, kode/SKU, stok dan UUID tetap. HTTP smoke test mengubah label FAST→SLOW dan memeriksa filter serta header CSV `kode_barang`. Pemeriksaan visual dan kamera fisik tetap belum dilakukan ulang.

## Verifikasi aplikasi scanner HP (Flutter) dan no reservasi

Diuji pada Windows 10 + **MySQL 8.4.3 (Laragon)** dengan database terpisah `warehouse_stock_test` (skema `database.sql` terbaru).

- Unit (Node): 13 test, termasuk validasi transaksi HP — OUT wajib no reservasi tepat 7 angka, IN menolak no reservasi, quantity harus bilangan bulat positif, field tambahan ditolak.
- Integration MySQL: 22 test. Baru: lookup tanpa foto; IN langsung mengubah stok (APPROVED); OUT menyimpan no reservasi dengan nol di depan (`0012345`); OUT melebihi stok ditolak tanpa transaksi; dua OUT bersamaan tidak membuat stok minus; stok 0, pending lama, dan barang nonaktif memblokir scanner.
- Report suite: 11 test lulus.
- HTTP smoke terhadap `next start` + database test: alur lama tetap lulus, ditambah `GET /api/scan/:token`, `POST /api/transactions` tanpa header Origin (seperti aplikasi HP), penolakan OUT tanpa reservasi, `history/reservations`, nama petugas, dan CSV dengan no reservasi di kolom pertama.
- Migrasi `005_reservation_number.sql` diterapkan ke database operasional setelah backup; jumlah barang/stok/transaksi tidak berubah.
- Flutter: `flutter analyze` bersih; 12 test (logika API/cookie/validasi + widget test alur jumlah → no reservasi → hasil, keyboard angka, huruf ditolak, batas 7 angka, penolakan server).
- Screenshot Chrome headless: tabel "No reservasi terbaru" di dashboard, halaman No Reservasi, sidebar tanpa link scanner, `/scanner` 404.

Catatan lingkungan: integration test membuat TRIGGER; pada MySQL 8 dengan binary log, jalankan dengan akun yang memiliki SUPER (mis. `DB_USER=root DB_PASSWORD= npm run test:integration`) atau set `log_bin_trust_function_creators=1`.

Belum diverifikasi pada perangkat fisik: kamera HP, izin kamera, senter, getaran, dan koneksi HTTPS dari HP ke IP LAN. Lakukan checklist penerimaan di README.

## Verifikasi impor lokasi, label pergerakan, dan stok Kg berkoma

Diuji pada Windows 10 + MySQL 8.4.3 (Laragon). Migrasi `007_decimal_stock_dead_label.sql` diterapkan ke database test lalu ke database operasional setelah backup.

- Unit (Node): 20 test lulus, termasuk Kg boleh berkoma tanpa pembulatan (`548.8 − 0.3 = 548.5`, `0.1 + 0.2 = 0.3`), satuan selain Kg menolak koma, label DEAD, pemetaan kode lokasi ERP, dan pembacaan CSV (baris bermasalah dilaporkan).
- Integration MySQL: 28 test lulus (ditambah impor CSV: lokasi ERP, label pergerakan, desimal Kg persis). Report suite 11 lulus, migration suite 1 lulus. `tsc` dan `next build` bersih.
- Flutter: `flutter analyze` bersih; 16 test lulus (ditambah keyboard desimal untuk Kg, input `0,3` → stok `548.8 → 548.5`, desimal ke-4 ditolak, satuan PCS membuang koma). APK release dibangun ulang.
- Impor ke database operasional: 2040 barang diperbarui, 0 dilewati. Label FAST 581 / SLOW 1428 / DEAD 31. Lima barang Kg tersimpan persis: CB4A60001 548.8, CB4A60002 62.6, CB4A60003 278.6, RA3A00001 10729.6, RA5A00002 1159.53. Pencocokan ulang seluruh 2040 baris CSV dengan database (stok, label, nama, kategori, lokasi): 0 selisih. POLE FACTORY menjadi ruangan sendiri; B.06.10.030 dipakai dua barang → barang kedua `B.06.10.030 (2)`. Ruangan sementara "Belum Ditempatkan" terhapus karena kosong.
- Screenshot Chrome headless halaman Barang: stok Kg tampil berkoma, label DEAD STOCK, kode lokasi ERP.

Belum diverifikasi di HP fisik: keyboard desimal (pemisah koma/titik tergantung keyboard HP; keduanya diterima).
