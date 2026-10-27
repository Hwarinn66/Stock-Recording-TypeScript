# Warehouse Stock Management — QR + MySQL

Aplikasi Next.js + TypeScript untuk gudang lokal Windows. Database **MySQL/MariaDB Laragon**, driver **mysql2/promise**, SQL langsung tanpa ORM. UI Tailwind CSS dengan komponen shadcn/ui, validasi Zod, QR generator `qrcode`, notifikasi Sonner. Scan dilakukan lewat **aplikasi Android Flutter** di folder [`mobile/`](mobile/README.md).

Untuk menjalankan secara online gratis (Vercel + database Aiven), ikuti [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md). Di Vercel dashboard mengecek perubahan stok tiap 15 detik; di PC/VPS sendiri tetap realtime (SSE).

## Alur utama

Tambah barang → stok awal 0 + UUID QR otomatis → cetak label → buka aplikasi **Warehouse Scanner** di HP → pilih IN/OUT → scan QR → ketik jumlah (keyboard angka) → khusus OUT: ketik **no reservasi 7 angka** → Selesai → SQL transaction langsung memperbarui stok dan histori → dashboard menerima SSE. No reservasi adalah identitas pengambilan dan divisi pengambil; daftarnya tampil di dashboard dan menu **Riwayat → No reservasi**.

Fitur: dashboard 7 indikator, master barang/kategori/ruangan/blok/rak/posisi, foto opsional tersimpan di MySQL, detail dan histori barang, regenerasi QR, label cetak, antrean multi-barang, adjustment stock opname dengan alasan, filter/search/sorting/pagination, CSV, soft disable barang, login server session, feedback suara/vibrasi HP. Semua data operasional berasal dari MySQL; browser tidak mengakses database.

## Lokasi bertingkat (v2)

Hierarki: **Ruangan → Blok → Rak → Nomor penempatan barang**.

| Ruangan   | Blok | Nomor rak | Nomor posisi | Lokasi barang |
| --------- | ---- | --------: | -----------: | ------------- |
| Ruangan 1 | A    |         1 |            1 | A.01.01       |
| Ruangan 1 | A    |         1 |            2 | A.01.02       |
| Ruangan 1 | A    |         2 |            1 | A.02.01       |
| Ruangan 1 | A    |         2 |            2 | A.02.02       |

- Satu rak boleh berisi beberapa barang di **posisi berbeda**. Satu posisi hanya boleh dipakai satu barang aktif.
- Nomor posisi unik **per rak**, sehingga posisi 1 pada rak A.01 dan A.02 diperbolehkan. Nomor rak unik per blok. Nomor ditampilkan minimal dua digit, tanpa memotong angka di atas 99.
- Layout standar sudah disiapkan: **Ruangan 1–5**, setiap ruangan memiliki **Blok A–D**, dan setiap blok memiliki **Rak 01–25**.
- Kode blok unik **per ruangan**, sehingga Blok A boleh ada di Ruangan 1, Ruangan 2, dan seterusnya. Kode posisi seperti A.01.01 juga boleh berulang di ruangan berbeda; nama ruangan selalu ditampilkan sebagai pembeda.
- **Nomor penempatan diinput langsung saat Tambah/Edit Barang.** Setelah memilih ruangan, blok, dan rak, ketik nomor posisi yang ingin dipakai. Backend membuat record posisi otomatis bila belum ada. Jika posisi pada rak tersebut sudah ditempati barang aktif, penyimpanan ditolak.
- Tambah/Edit Barang memakai empat pilihan bertingkat. Posisi terisi ditandai dan tidak dapat dipilih untuk barang lain. Backend dan UNIQUE constraint tetap menjadi pengaman akhir terhadap dua request bersamaan.
- UUID QR tetap **per barang**, bukan per rak; tempel label pada **posisi barang** masing-masing. IN/OUT, anti-double-scan dan approval tidak berubah.
- Identitas blok/rak yang sudah berisi anak dan identitas posisi yang sudah dipakai tidak dapat diganti. Buat lokasi tujuan dan pindahkan barang lewat Edit Barang. Nama/keterangan tetap dapat diedit. Histori menyimpan kode lokasi dan nama ruangan saat transaksi.
- API `/api/locations` kini berarti **posisi**. POST/PATCH menerima `{rack_id,position_number,name,description?,active?}`; `code` dirangkai server, jangan diketik manual.
- Master baru: GET/POST `/api/rooms` (`name`), `/api/blocks` (`room_id,code,name`), `/api/racks` (`block_id,rack_number,name`), serta PATCH/DELETE `/:id` masing-masing. Semua memerlukan session dan validasi.
- `products.location_id` tetap menunjuk ID posisi. Tabel `locations` tidak dihapus sehingga foreign key produk/histori tetap stabil. Filter barang mendukung `room_id`, `block_id`, `rack_id`, dan `location_id`.

### Upgrade database yang sudah dipakai

**Jangan import ulang `database.sql` ke database lama.** Gunakan migrasi berikut sekali:

1. Backup database melalui HeidiSQL/phpMyAdmin. Hentikan aplikasi selama migrasi.
2. Pilih database **warehouse_stock** yang sudah ada, lalu jalankan seluruh file **`migrations/002_location_hierarchy.sql`** dalam satu sesi.
3. Lokasi lama seperti `A-01` dipetakan ke Ruangan 1 / Blok A / Rak 01 / Posisi 01 → **A.01.01**. Jika ada alias `A.01` dan `A-01`, keduanya menjadi posisi berbeda dalam rak yang sama berdasarkan ID lama.
4. Kode lama yang tidak berpola huruf + nomor ditempatkan pada Blok **LEGACY**, nomor rak mengikuti ID lokasi lama. Kolom `legacy_code` menyimpan kode asli untuk pemeriksaan.
5. ID lokasi, stok barang, UUID QR dan histori transaksi lama **dipertahankan**. Histori lama tetap menampilkan kode lama; ruangan historis yang belum pernah dicatat ditampilkan kosong. Pending lama tetap dapat diapprove/cancel.
6. Ruangan 1 adalah asumsi migrasi karena versi lama tidak menyimpan ruangan. Periksa pemetaan fisik; buat lokasi tujuan yang benar dan pindahkan barang bila perlu. Cetak ulang label agar teks lokasi baru sesuai. QR yang sama tetap berlaku.
7. Jalankan source baru. DDL MySQL melakukan implicit commit; bila migrasi terhenti, **restore backup** sebelum mengulang. File migrasi bukan script idempotent.

Untuk instalasi baru, cukup import `database.sql` terbaru; **tidak perlu menjalankan migrasi**. Uji migrasi otomatis: `npm run test:migration` menggunakan database sementara acak dan memerlukan izin CREATE/DROP DATABASE pada server test. Script menolak konfigurasi DB_NAME yang tidak berakhiran `_test`.

Nama barang dari ERP bisa lebih dari 160 karakter: jalankan **`migrations/006_product_name_length.sql` sekali** (kolom `products.name` menjadi 255 karakter).

**Stok berkoma untuk satuan Kg dan label Dead stock:** jalankan **`migrations/007_decimal_stock_dead_label.sql` sekali** setelah backup. Kolom stok dan quantity menjadi `DECIMAL(15,3)` (nilai lama tetap sama) dan label pergerakan menerima `DEAD`. Aturannya: **hanya barang bersatuan Kg** (termasuk tulisan `K g`) boleh berkoma, maksimal 3 angka di belakang koma, dan **tidak pernah dibulatkan**. Satuan lain tetap bilangan bulat; server menolak jumlah berkoma untuk satuan tersebut (`INVALID_QUANTITY`). Aturan ini berlaku di aplikasi HP, approve pending, dan adjustment.

### Impor barang dari CSV ekspor ERP

Mengimpor **kode barang (`nobar`), nama (`nabar`), satuan (`satuan`), sisa stok (`saldoakhir`), lokasi (`lokasi2`), dan status pergerakan (`stock_type`)** tanpa histori:

```powershell
npm run products:import -- --category=ATK "C:\Users\...\POSISI1_atk.csv" --category=Sparepart "C:\Users\...\POSISI1_part.csv"
```

Tanpa `--apply` hanya pratinjau; tambahkan `--apply` untuk menyimpan (satu SQL transaction, backup dahulu). Opsi `--room="Ruangan 1"` menentukan ruangan untuk kode lokasi ERP (default Ruangan 1).

- **Lokasi:** kode ERP `AREA.rak.tingkat.urutan` (mis. `B.06.24.017`) menjadi Blok `B` / Rak `06` / posisi `24017`; kode aslinya disimpan apa adanya sehingga tampilan dan label sama dengan ERP. Kode non-standar (mis. `POLE FACTORY`) menjadi ruangan tersendiri. Dua barang dengan kode lokasi yang sama: barang kedua mendapat posisi `KODE (2)`. Barang tanpa kode lokasi masuk ruangan **Belum Ditempatkan**.
- **Status pergerakan:** `FAST MOVING` → Fast, `SLOW MOVING` → Slow, `DEAD STOCK` → Dead stock.
- **Saldo:** Kg disimpan persis (mis. `1159.53`); saldo berkoma untuk satuan selain Kg dan saldo lebih dari 3 desimal dilaporkan lalu dilewati.

Kode barang yang sudah ada diperbarui nama, satuan, stok, lokasi, dan labelnya (kategori tetap); barang dengan transaksi pending dilewati. Impor ulang file yang sama tidak membuat data dobel.

Untuk mencatat no reservasi, database yang sudah ada perlu **`migrations/005_reservation_number.sql` sekali** setelah backup. Migrasi ini hanya menambah kolom `stock_transactions.reservation_number` (NULL) dan index; data lama tidak berubah.

Untuk database yang sudah memakai hierarki lokasi v2/v3, jalankan **`migrations/004_standard_warehouse_layout.sql` sekali** setelah backup. Migrasi ini mengizinkan Blok A–D berulang di tiap ruangan, menambahkan Ruangan 1–5, Blok A–D, dan Rak 01–25 tanpa menghapus barang atau histori yang sudah ada. Setelah itu, posisi tetap dibuat manual sesuai kebutuhan.

## Kode Barang dan label Fast/Slow manual

**Kode Barang** adalah identitas unik setiap varian, memakai kolom `products.sku` yang sudah ada. Tidak dibuat dua identitas yang saling bertentangan. Kode diisi saat Tambah Barang; kode barang lama tetap dipertahankan. Huruf kecil disimpan sesuai input; unique constraint MySQL tidak membedakan huruf besar/kecil sehingga `a0001` dan `A0001` tidak dapat menjadi dua barang berbeda. Kode tidak dapat diedit setelah barang dibuat.

| Kode Barang | Nama barang / kapasitas | Contoh posisi |
| ----------- | ----------------------- | ------------- |
| a0001       | Ember 1 kg              | A.01.01       |
| a0002       | Ember 1,2 kg            | A.01.02       |

Isi kapasitas/ukuran pada nama barang. Kode ditampilkan sebagai kolom tersendiri di tabel, lebih besar pada label QR cetak, hasil scan HP dan transaksi pending. Cocokkan kode pada label posisi dan barang saat pengambilan, terutama untuk varian yang berdampingan. QR tetap token unik, bukan kode barang; pencarian mendukung kode dan nama. CSV produk/histori memakai header `kode_barang`; JSON API tetap memakai `sku` agar kompatibel.

**Fast/Slow adalah label manual milik gudang**, dipilih pada Tambah/Edit Barang dan disimpan dalam MySQL (`movement_class`: `FAST`, `SLOW`, `DEAD`, atau NULL). Tidak ada rumus, ambang, periode, atau klasifikasi berdasarkan OUT. Label tidak berubah saat scan, approve, cancel atau adjustment. Barang tanpa label tetap tampil sebagai **Belum diberi label**, tidak dianggap Slow secara otomatis.

Pilihan **Barang → Urutkan**:

| Pilihan                                 | Hasil                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Nama A–Z (default)                      | Semua barang sesuai filter, alfabetis tanpa memisahkan label                         |
| Stok terbanyak                          | Stok saat ini terbesar dahulu, nama A–Z untuk nilai sama                             |
| Total OUT terbanyak                     | Jumlah unit OUT APPROVED sepanjang histori, terbesar dahulu; tidak memengaruhi label |
| Lokasi A.01.01 → terakhir               | Ruangan, blok, nomor rak, lalu posisi secara numerik                                 |
| Kelompok Fast → Slow → Dead, A–Z        | Fast A–Z, Slow A–Z, Dead A–Z, lalu Belum diberi label A–Z                            |
| Fast moving saja · A–Z                  | Hanya label manual Fast                                                              |
| Slow moving saja · A–Z                  | Hanya label manual Slow                                                              |
| Dead stock saja · A–Z                   | Hanya label manual Dead stock                                                        |
| Belum diberi label · A–Z                | Barang yang belum diklasifikasikan oleh user                                         |
| Kode Barang A–Z                         | Urut identitas kode barang                                                           |

Pengelompokan dilakukan backend SQL sebelum pagination. CSV mengikuti filter dan urutan, mencantumkan kode barang, total OUT dan label manual. Perbandingan total unit OUT perlu memperhatikan satuan masing-masing barang. Hanya OUT APPROVED dengan waktu approve tidak di masa depan yang dihitung untuk total tersebut.

### Upgrade label manual

- **Database lama versi v2:** backup dan hentikan aplikasi, pilih database `warehouse_stock`, lalu jalankan **`migrations/003_manual_movement_label.sql` sekali**. Ini menambah kolom label kosong dan index. Stok, kode barang, QR dan histori tidak diubah.
- Bila belum memasang hierarki lokasi, jalankan migrasi **002 lalu 003** berurutan. Jangan menjalankan ulang migrasi yang sudah diterapkan.
- **Instalasi baru:** import `database.sql` terbaru saja, tanpa menjalankan migrasi tambahan.
- Setelah upgrade, buka Barang → Edit → **Label pergerakan (manual)** untuk mengisi label Fast/Slow yang sudah Anda miliki. Selesaikan pending dahulu bila barang terkunci.

API POST/PATCH produk menerima `movement_class:"FAST"`, `"SLOW"`, `"DEAD"`, atau `null` (hapus label). Omit field saat PATCH untuk mempertahankan label. Kode barang tetap memakai `sku`. GET produk: `sort=name|stock|out_total|location|movement|fast|slow|dead|unlabelled|sku|id`. Parameter periode dan ambang versi sebelumnya sudah tidak digunakan. Histori tetap default transaksi terbaru dahulu.

Pengujian `npm run test:reports` memastikan label manual terpisah dari OUT, termasuk Fast tanpa OUT, Slow dengan OUT tinggi, hapus label, urutan A–Z, CSV, serta kode unik varian kapasitas berdampingan.

## Saat web error: cadangan Excel, buku darurat, antrean offline HP

Tiga lapis cadangan. Arah datanya sengaja dibuat aman: Excel cadangan **hanya dibaca**, dan semua yang dicatat saat darurat masuk ke web sebagai **transaksi** (bukan angka stok). Dengan begitu, perubahan yang terjadi bersamaan tidak saling menimpa.

**Wajib sekali setelah update ini:** backup database, lalu jalankan **`migrations/008_client_ref.sql`** di setiap database yang dipakai (Laragon dan/atau Aiven) **sebelum** source baru dijalankan/di-deploy. Migrasi hanya menambah kolom `stock_transactions.client_ref` (NULL) dan unique index; data lama tidak berubah. Tanpa migrasi ini transaksi dari HP akan gagal.

### 1. Cadangan Excel otomatis di komputer

Klik dua kali **`scripts\backup-excel.cmd`** (memakai `.env.aiven` bila ada, selain itu `.env.local`), atau jalankan `npm run excel:backup:cloud` / `npm run excel:backup`. Biarkan jendelanya terbuka. Program memeriksa database setiap 3 detik dan menulis ulang file bila ada perubahan:

- **`Desktop\Backup Gudang\stok-gudang.xlsx`** berisi sheet *Stok Barang* (stok terakhir semua barang aktif), *Riwayat Transaksi* (90 hari terakhir), dan *Keterangan*. Kode barang & no reservasi disimpan sebagai teks (nol di depan tidak hilang), stok sebagai angka, tanggal & jam sebagai nilai tanggal/jam Excel dalam WIB. File diberi atribut read-only: Excel membukanya sebagai *Read-Only*, dan file tetap diperbarui walau sedang dibuka (tutup lalu buka lagi untuk melihat data terbaru).
- **`Desktop\Backup Gudang\buku-darurat.xlsx`** dibuat sekali bila belum ada, dan tidak pernah ditimpa.

Database dibaca langsung, jadi cadangan tetap berjalan walau website (Vercel) error. Opsi di `.env`: `EXCEL_BACKUP_DIR` (folder lain), `EXCEL_BACKUP_SECONDS`, `EXCEL_HISTORY_DAYS`. Agar otomatis jalan saat komputer menyala: Win+R → `shell:startup` → buat shortcut `scripts\backup-excel.cmd` di folder itu. Cadangan yang sama bisa diunduh kapan saja dari web: **Pengaturan → Unduh cadangan Excel**.

### 2. Buku darurat Excel (bila web & HP tidak bisa dipakai)

Petugas mengisi `buku-darurat.xlsx`, satu baris per barang masuk/keluar: Tanggal (**Ctrl+;**), Jam (**Ctrl+Shift+;**), Jenis (pilih Masuk/Keluar), Kode Barang, Jumlah, No Reservasi (wajib untuk Keluar), Petugas, Catatan. Nama Barang & Satuan terisi otomatis dari sheet *Daftar Barang*; kode salah ketik tampil "KODE TIDAK DITEMUKAN". Kolom otomatis dikunci, isian divalidasi Excel.

Setelah web normal: **Pengaturan → Unggah buku darurat** → periksa pratinjau → **Simpan**. Baris diproses urut waktu kejadian dan diperiksa seperti transaksi HP (barang aktif, stok cukup, no reservasi). Tanggal/jam transaksi dan nomornya (mis. `OUT-20261025-…`) mengikuti waktu kejadian; catatan berisi nomor baris, petugas, dan pengunggah. Baris bermasalah dilewati dan dilaporkan, baris lain tetap tersimpan. File yang sama **boleh diunggah ulang**: baris yang sudah tersimpan dilewati, jadi setelah memperbaiki baris bermasalah cukup unggah ulang. Baris yang sudah tersimpan lalu diubah isinya ditandai *Isi berbeda* (perbaiki lewat Revisi di Riwayat), tidak dicatat dua kali. Jangan menyalin file buku untuk dipakai sebagai buku baru; unduh template baru (Pengaturan → Unduh template buku darurat).

### 3. Antrean offline di aplikasi HP

Aplikasi HP menyimpan daftar barang (diperbarui otomatis tiap 30 menit saat online). Bila server tidak terjangkau, QR tetap dikenali dari daftar itu dan transaksi disimpan di HP ("Tersimpan di HP"), lalu dikirim otomatis saat server bisa dihubungi lagi, lengkap dengan **waktu kejadian aslinya**. Menu utama HP menampilkan jumlah antrean dan transaksi yang ditolak server (mis. stok ternyata tidak cukup) untuk dicek, dikirim ulang, atau dihapus. Setiap transaksi HP membawa kunci unik (`client_ref`), sehingga sinyal yang putus setelah server menyimpan, atau antrean yang terkirim dua kali, tidak pernah mencatat transaksi ganda. Antrean menerima waktu kejadian maksimal 7 hari ke belakang.

## Persyaratan

- Windows 10/11, Laragon dan MySQL **8.0.16+** atau MariaDB **10.6+**, engine InnoDB. Versi ini diperlukan untuk generated columns dan CHECK constraints.
- Node.js **22 LTS atau lebih baru**, npm, browser modern.
- 1 smartphone dan komputer dalam Wi-Fi/LAN yang sama. Untuk kamera melalui IP LAN: HTTPS dengan sertifikat yang **dipercaya smartphone**.
- Aplikasi dijalankan sebagai server Node.js (`next dev` atau `next start`), bukan melalui Apache/PHP Laragon.

## Instalasi Windows / Laragon

1. Clone/copy repository, lalu buka terminal di folder proyek:
   ```powershell
   git clone https://github.com/Hwarinn66/pencatatan-stock.git
   cd pencatatan-stock
   npm install
   ```
2. Buka Laragon → **Start MySQL**. Periksa port yang dipakai (biasanya 3306).
3. Buka HeidiSQL atau phpMyAdmin dari Laragon. Import **`database.sql`** sebagai SQL script. File berisi `CREATE DATABASE`, `USE`, tabel, foreign key, indexes, unique constraints dan seed. Import **sekali ke database baru**, bukan ke database produksi yang sudah terisi.
4. Pastikan database `warehouse_stock` dan tabelnya tersedia. HeidiSQL: File → Load SQL file → pilih `database.sql` → jalankan seluruh script. phpMyAdmin: tab Import → pilih file → Go.
5. Buat konfigurasi lokal:
   ```powershell
   Copy-Item .env.example .env.local
   ```
   Isi `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`. Credential tidak disimpan dalam source code. Untuk Laragon standar user sering `root` dengan password kosong; sesuaikan instalasi Anda.
6. Buat akun. **Tidak ada password default / akun publik dalam seed.** Gunakan password pribadi minimal 8 karakter, maksimal 72 byte:
   ```powershell
   npm run user:create -- admin "GantiDenganPasswordPribadiAnda"
   ```
   Password di-hash bcrypt cost 12. Perintah membuat akun baru, tidak menimpa akun yang ada. Untuk mengganti password user yang sudah ada, gunakan `npm run user:password -- admin "PASSWORD-BARU"`. Hindari membagikan history terminal yang berisi password. Bila password mengandung `$` atau karakter khusus PowerShell, gunakan petik tunggal.
7. Jalankan:
   ```powershell
   npm run dev
   ```
8. Buka `http://localhost:3000`, login dengan akun tadi. Script dev sudah bind `0.0.0.0`.

Untuk pemakaian stabil setelah setup:

```powershell
npm run build
npm start
```

Restart server setelah mengubah `.env.local`. Jangan commit `.env.local`, `.env.test`, atau private key sertifikat.

## Data awal

Instalasi baru tidak membuat barang contoh. Dashboard dimulai tanpa barang dan tanpa histori transaksi. Struktur gudang awal berisi Ruangan 1–5, Blok A–D pada setiap ruangan, dan Rak 01–25 pada setiap blok. Nomor penempatan dibuat otomatis saat Anda mengetiknya pada form Tambah/Edit Barang.

Untuk mengosongkan database operasional yang sudah dipakai dan kembali ke kondisi awal tanpa menghapus akun login, kategori, atau struktur lokasi gudang:

```powershell
npm run data:reset -- --yes
```

Perintah ini menghapus seluruh barang, seluruh nomor penempatan, transaksi pending, histori IN/OUT/adjustment, counter nomor transaksi, dan event realtime. Ruangan 1–5, Blok A–D, Rak 01–25, kategori, dan akun login tetap dipertahankan. ID barang/transaksi/posisi juga dimulai kembali dari 1. Gunakan hanya setelah backup bila data lama masih diperlukan.

## Akses dari smartphone

1. Sambungkan HP dan komputer ke Wi-Fi yang sama; matikan client/AP isolation pada router jika aktif.
2. Di terminal Windows jalankan `ipconfig`, cari **IPv4 Address** adapter Wi-Fi aktif, misalnya `192.168.1.10`.
3. `npm run dev` sudah setara dengan `next dev --hostname 0.0.0.0`.
4. Tambahkan origin LAN ke konfigurasi, misalnya:
   ```dotenv
   APP_URL=http://localhost:3000
   ALLOWED_ORIGINS=http://localhost:3000,http://192.168.1.10:3000
   COOKIE_SECURE=false
   ```
5. Izinkan aplikasi Node.js/port TCP 3000 pada **Windows Firewall untuk profil Private**, bukan seluruh jaringan publik. Contoh PowerShell Administrator:
   ```powershell
   New-NetFirewallRule -DisplayName "Warehouse LAN 3000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private -RemoteAddress LocalSubnet
   ```
6. Di aplikasi Warehouse Scanner, isi alamat server `http://192.168.1.10:3000` lalu login. Lihat [mobile/README.md](mobile/README.md).

## HTTPS lokal

`localhost` pada HP menunjuk HP sendiri, bukan komputer. Aplikasi scanner Flutter membawa sertifikat CA mkcert milik komputer ini (`mobile/assets/certs/rootCA.crt`), sehingga **HP tidak perlu memasang sertifikat** — langkah 2–3 di bawah hanya diperlukan bila HP membuka dashboard lewat browser. Bila CA mkcert dibuat ulang, salin `rootCA.pem` baru ke file tersebut lalu build ulang APK.

Cara yang disarankan untuk prototype LAN adalah **mkcert** dengan local CA yang dipercaya kedua perangkat (lihat [dokumentasi resmi mkcert](https://github.com/FiloSottile/mkcert)).

1. Install mkcert di Windows (misalnya `winget install FiloSottile.mkcert`), lalu:
   ```powershell
   mkcert -install
   New-Item -ItemType Directory -Force certificates
   mkcert -key-file certificates/local-key.pem -cert-file certificates/local.pem localhost 127.0.0.1 192.168.1.10
   mkcert -CAROOT
   ```
   Ganti IP dengan IPv4 komputer. Bila IP berubah, buat ulang sertifikat atau tetapkan DHCP reservation.
2. Dari folder CA yang ditampilkan, salin **hanya `rootCA.pem`** ke HP (dapat diubah nama menjadi `rootCA.crt` untuk installer sertifikat). **Jangan menyalin `rootCA-key.pem` atau `local-key.pem`.**
3. Android: Settings → Security / Encryption & credentials → Install a certificate → CA certificate; menu berbeda menurut produsen. iOS: install profile sertifikat, lalu Settings → General → About → Certificate Trust Settings → aktifkan full trust untuk CA itu. Lakukan hanya untuk CA prototype milik Anda dan hapus trust setelah pengujian selesai.
4. Ubah `.env.local`:
   ```dotenv
   APP_URL=https://localhost:3000
   ALLOWED_ORIGINS=https://localhost:3000,https://192.168.1.10:3000
   COOKIE_SECURE=true
   ```
5. Jalankan `npm run dev:https`. Script memakai key/cert pada `certificates/`. Flag HTTPS hanya tersedia pada development Next.js, bukan `next start`.
6. Di aplikasi Warehouse Scanner isi alamat **`https://192.168.1.10:3000`**. IP harus tercantum di sertifikat (`mkcert ... 192.168.1.10`); jika tidak, aplikasi menampilkan "Sertifikat HTTPS server tidak dipercaya".
7. Untuk penggunaan produksi lokal, terminasi HTTPS dengan reverse proxy lokal (mis. Caddy/IIS) ke `next start`, pertahankan origin yang benar dan `COOKIE_SECURE=true`.

Lihat [Next.js CLI — HTTPS](https://nextjs.org/docs/app/api-reference/cli/next). Tidak diperlukan database cloud atau tunnel publik.

## Penggunaan

- **Tambah Barang**: Kode Barang unik, nama, kategori, satuan, ruangan, blok, rak, dan nomor penempatan wajib. Nomor penempatan diketik langsung; posisi dibuat otomatis bila belum ada dan ditolak jika sudah ditempati barang aktif. Tidak ada input stok. Foto PNG/JPEG/WebP maksimum 1 MB, disimpan di MySQL; SVG tidak diterima.
- **QR Barang**: download SVG, Print QR dengan nama/SKU/lokasi lengkap dan ruangan. QR hanya memuat UUID, bukan SKU atau nomor rak. Regenerate membatalkan token lama; cetak dan ganti label setelahnya.
- **Aplikasi scanner HP**: pilih IN/OUT → scan QR → backend memeriksa barang (aktif, tidak pending, OUT tidak stok 0) → ketik jumlah (keyboard angka, huruf ditolak; OUT tidak boleh melebihi stok) → OUT: no reservasi tepat 7 angka → Selesai. Transaksi tersimpan **APPROVED** dan stok langsung berubah, tanpa approval komputer. Kamera mati selama layar jumlah/reservasi/hasil terbuka; **Scan berikutnya** menyalakannya lagi.
- **No Reservasi**: tab di menu **Riwayat** dan tabel "No reservasi terbaru" di dashboard: no reservasi, waktu, kode/nama barang, qty, lokasi, petugas (akun yang scan), nomor transaksi. Pencarian riwayat menerima no reservasi; CSV `riwayat-reservations` menaruh no reservasi di kolom pertama.
- **Transaksi Pending**: daftarnya ada di Dashboard (bagian Transaksi menunggu). Alur lama (scan → approve di komputer) masih tersedia untuk pending yang sudah ada dan client API lama (`POST /api/scan`). Isi jumlah positif (bilangan bulat; barang Kg boleh berkoma maks. 3 desimal), lihat preview, Approve atau Batalkan.
- **Koreksi Stok**: buka barang di menu **Barang** → **Edit**; bagian **Koreksi stok** ada di bawah form data barang (satu halaman dengan Edit Barang). Kolom jumlah otomatis terisi stok di web; ganti dengan **jumlah yang sebenarnya ada di gudang** (mis. web 10, gudang 8 → ketik 8). Selisih dihitung otomatis. Pilih alasan (Rusak, Hilang, Kedaluwarsa, Ditemukan, Selisih stock opname, Salah input, Lainnya + keterangan). Backend memeriksa stok yang dilihat user masih sama; jika berubah, muat ulang. Quantity histori koreksi adalah selisih (dapat negatif); riwayatnya ada di detail barang dan di **Riwayat → Koreksi stok**.
- **Lokasi**: dipilih di form Tambah/Edit Barang (ruangan → blok → rak → nomor penempatan; posisi baru dibuat otomatis). Menu Lokasi Gudang sudah dihapus; ruangan/blok/rak baru dapat ditambahkan lewat API `/api/rooms`, `/api/blocks`, dan `/api/racks`.
- **Edit/rak**: stok dan Kode Barang tidak dapat diedit. Perpindahan rak membutuhkan konfirmasi; posisi baru harus kosong (rak yang sama boleh menampung barang lain). Histori menyimpan ID dan kode rak saat transaksi, tidak berubah saat master rak diedit.
- **Nonaktifkan**: record barang dipertahankan. QR nonaktif ditolak. Tidak dapat mengubah barang/rak/QR/adjustment saat ada pending; selesaikan dahulu.
- **Dashboard**: setiap kotak angka bisa diklik dan membuka datanya (daftar barang, riwayat masuk/keluar/semua transaksi hari ini, tab stok menipis/habis, atau daftar transaksi menunggu).
- **Riwayat**: satu menu dengan tab Semua, Barang masuk, Barang keluar, No reservasi, dan Koreksi stok. Filter tanggal juga bisa diisi lewat alamat, mis. `/history/in?from=2026-10-24&to=2026-10-24`. Semua status tersedia, filter tanggal berdasarkan `scanned_at` di timezone aplikasi. IN/OUT hari ini pada dashboard dihitung berdasarkan `approved_at`, hanya APPROVED. CSV mengekspor seluruh hasil filter, bukan hanya halaman saat ini. Waktu CSV adalah UTC dari database. Formula berbahaya pada CSV dinetralkan.
- **Revisi transaksi**: di menu **Riwayat** (tab Barang masuk, Barang keluar, atau No reservasi) klik **nama barang** untuk memperbaiki jumlah dan/atau no reservasi (khusus barang keluar) yang salah input. Stok barang disesuaikan sebesar selisih jumlah (mis. keluar tercatat 5, sebenarnya 3 → stok naik 2) dan ditolak bila stok menjadi minus. Jejak revisi (waktu, user, perubahan, alasan) ditambahkan ke kolom Alasan. Transaksi pending, dibatalkan, dan koreksi stok tidak dapat direvisi. Stok sebelum/sesudah pada transaksi yang direvisi dihitung ulang dari stok sebelumnya; transaksi lain tidak diubah.
- **Stok menipis / habis**: tab di halaman **Barang** (menipis = `<=2`, termasuk 0). **Kategori** dikelola di menu **Pengaturan**. Card dashboard memisahkan stok 1–2 dan stok 0.

## Konsistensi database dan keamanan

- Semua SQL melalui backend, menggunakan parameter `?` dan connection pool terpusat di `src/lib/db.ts`.
- Scan melakukan SQL transaction: lock product `FOR UPDATE`, validasi aktif/token/stock OUT, cari pending dengan lock, lalu insert pending + event outbox. Token diverifikasi lagi setelah lock, sehingga regenerasi bersamaan tidak mengaktifkan token lama.
- Transaksi dari aplikasi HP (`POST /api/transactions`) memakai lock yang sama: product `FOR UPDATE`, verifikasi token/aktif/pending, hitung stok baru (tidak boleh negatif), update stok + insert transaksi APPROVED + event dalam satu SQL transaction. Dua OUT bersamaan tidak dapat membuat stok minus.
- Generated column `pending_product_id` + UNIQUE adalah perlindungan tambahan satu pending per barang. `active_location_id` + UNIQUE menjamin satu barang aktif per posisi.
- Approve/cancel/quantity selalu lock **product dulu, transaction kemudian**. Validasi status terminal, quantity, overflow dan stock terbaru. Stok tidak boleh negatif. Semua query satu transaksi menggunakan **connection mysql2 yang sama**. Gagal di mana pun → rollback.
- Nomor transaksi: counter harian per IN/OUT/ADJ, dibuat dalam transaction dengan upsert yang terkunci, ditambah unique constraint. Format `IN-YYYYMMDD-0001` (angka melebar bila >9999).
- SSE membaca `stock_events` outbox di MySQL tiap 1 detik. Revisi memakai MAX(id) dan COUNT(*) agar commit yang selesai tidak berurutan tetap terdeteksi. Event ditulis dalam transaction yang sama; tidak ada event untuk perubahan yang rollback. Mendukung beberapa proses Node karena tidak bergantung pada EventEmitter memory. Klien reconnect dan fallback polling 5 detik bila SSE gagal. Ini bukan binlog streaming; latensi normal sekitar 1 detik plus jaringan. Semua komponen dalam satu tab berbagi satu koneksi SSE. Server memangkas `stock_events` sekali per jam (1000 event terakhir disimpan) dan memeriksa session SSE tiap 10 detik; API tetap menolak session kedaluwarsa seketika.
- Server session opaque random 256-bit; database hanya menyimpan SHA-256 token, cookie HttpOnly + SameSite=Lax, Secure bila dikonfigurasi. Expiry default 12 jam. Semua halaman operasional dan API termasuk scan/QR/SSE memerlukan login. Endpoint login adalah pengecualian yang memang harus publik; logout menghapus session database.
- Login dibatasi 10 percobaan per username per 15 menit. Perangkat yang pernah login sukses mendapat cookie `warehouse_device` (90 hari) dan memakai kuota sendiri, sehingga percobaan gagal dari perangkat lain tidak dapat mengunci komputer/HP gudang. Mutasi browser memeriksa Origin terhadap `APP_URL`/`ALLOWED_ORIGINS`. Tidak ada wildcard. Database credential tidak dikirim ke browser.
- Timestamp disimpan dalam UTC (connection timezone +00:00); UI/nomor transaksi/rekap harian memakai `APP_TIMEZONE`, default `Asia/Jakarta`. Waktu HP tidak dipercaya.
- Gunakan akun DB aplikasi dengan izin seperlunya setelah import/setup (SELECT/INSERT/UPDATE/DELETE). Jangan buka port 3306 ke HP; HP hanya mengakses port aplikasi.
- Backup database via HeidiSQL/phpMyAdmin sebelum pemakaian sungguhan. Jangan mengubah stock secara manual lewat SQL saat operasi berjalan.

## API

Semua API berbasis JSON kecuali QR SVG, CSV dan SSE. Autentikasi menggunakan session cookie. Respons normal `{success:true,message,data}`, error `{success:false,code,message,details?}`. Validation 422, konflik 409, unauthenticated 401.

| Method       | Endpoint                                                          | Input/keterangan                                   |
| ------------ | ----------------------------------------------------------------- | -------------------------------------------------- |
| POST         | `/api/auth/login`                                                 | `{username,password}`                              |
| POST         | `/api/auth/logout`                                                | logout session                                     |
| GET          | `/api/auth/me`                                                    | user aktif                                         |
| GET          | `/api/scan/:qr_token?mode=IN\|OUT`                                | cek barang hasil scan (aplikasi HP)                |
| POST         | `/api/transactions`                                               | `{qr_token,mode,quantity,reservation_number?,client_ref?,recorded_at?}`; OUT wajib no reservasi 7 angka; stok langsung berubah. `client_ref` (UUID) sama = dijawab dengan transaksi yang sudah ada (`replayed:true`); `recorded_at` (ISO, maks. 7 hari lalu) untuk antrean offline |
| GET          | `/api/catalog`                                                    | barang aktif + `qr_token` untuk disimpan di HP (scan offline) |
| GET          | `/api/backup/excel`                                               | unduh cadangan Excel (stok + riwayat 90 hari)      |
| GET          | `/api/emergency/template`                                         | unduh template buku darurat (.xlsx)                |
| POST         | `/api/emergency/preview`, `/api/emergency/apply`                  | body = isi file .xlsx (maks. 4 MB); pratinjau / simpan buku darurat |
| POST         | `/api/scan`                                                       | lama: `{qr_token,mode}` → transaksi PENDING        |
| GET          | `/api/pending-transactions`                                       | daftar pending                                     |
| PATCH        | `/api/transactions/:id/quantity`                                  | `{quantity}`                                       |
| PATCH        | `/api/transactions/:id/revise`                                    | `{quantity?,reservation_number?,reason?}`; revisi IN/OUT APPROVED, stok disesuaikan selisih |
| POST         | `/api/transactions/:id/approve`                                   | `{quantity}` atau quantity tersimpan               |
| POST         | `/api/transactions/:id/cancel`                                    | `{}`                                               |
| GET/POST     | `/api/products`                                                   | list / create                                      |
| GET/PATCH    | `/api/products/:id`                                               | detail / edit, `{active:false}` untuk nonaktif     |
| GET/POST     | `/api/products/:id/qr`                                            | SVG / regenerate                                   |
| GET          | `/api/history/in`, `/api/history/out`, `/api/history/adjustments` | histori                                            |
| GET          | `/api/history/reservations`                                       | OUT yang memiliki no reservasi                     |
| POST         | `/api/adjustments`                                                | `{product_id,physical_stock,expected_stock,notes}` |
| GET          | `/api/dashboard`                                                  | statistik                                          |
| GET/POST     | `/api/categories`, `/api/locations`                               | list/create                                        |
| PATCH/DELETE | `/api/categories/:id`, `/api/locations/:id`                       | edit/delete jika tidak direferensikan              |
| GET          | `/api/events`                                                     | SSE event `update`                                 |
| GET          | `/api/settings`                                                   | konfigurasi publik, tanpa credential               |

List products/history: `q,page,limit,sort,direction,location_id`; products menambah `category_id,stock=low|zero|safe,active=0|1|all`; history menambah `product_id,status,from,to`. CSV: `export=csv`. Field sort dipetakan ke daftar kolom internal, tidak diinterpolasi mentah dari input.

Client nonbrowser (aplikasi Flutter, scanner fisik) tidak mengirim header Origin dan wajib menyertakan cookie session hasil login. Halaman scanner web `/scanner` sudah dihapus; scan memakai aplikasi di `mobile/`.

## Struktur

```text
src/app/                  Next.js pages dan route handlers
src/components/ui/        Komponen shadcn/ui
src/components/workspace/ Dashboard, master data, QR, histori
mobile/                   Aplikasi scanner Android (Flutter), lihat mobile/README.md
src/hooks/use-live.ts      SSE + fallback polling
src/lib/db.ts              mysql2 pool dan transaction helper
src/lib/auth.ts            Login, session, Origin check
src/services/             SQL dan business logic
src/validators/           Zod schema
src/types/                Tipe domain
scripts/create-user.ts    Pembuatan akun bcrypt
tests/                    Unit dan integration tests
database.sql              Schema + seed Laragon
```

## Pengujian

```powershell
npm run typecheck
npm test
npm run build
```

### Integration test MariaDB/MySQL sungguhan

Test akan **menghapus data dalam database test**, sehingga sengaja menolak DB_NAME yang tidak berakhiran `_test`.

1. Buat salinan schema khusus test:
   ```powershell
   (Get-Content database.sql -Raw).Replace('warehouse_stock','warehouse_stock_test') | Set-Content -Encoding utf8 database.test.sql
   ```
2. Import `database.test.sql` ke MySQL seperti sebelumnya. Jangan gunakan database operasional.
3. Copy `.env.example` menjadi `.env.test`; isi credential database dan `DB_NAME=warehouse_stock_test`.
4. Jalankan `npm run test:integration`.

Suite menguji create/QR/stock 0, IN/OUT, concurrent scan antar-mode, cancel/unlock, quantity melebihi stock, low stock, duplicate position, simultaneous approvals, adjustment/stale stock, perpindahan rak, token lama dan barang nonaktif. Rollback diuji dengan **trigger test yang sengaja menggagalkan INSERT outbox setelah UPDATE stock**; pastikan user DB test mempunyai izin CREATE/DROP TRIGGER.

### Checklist penerimaan perangkat (wajib dilakukan di LAN Anda)

| Test | Langkah                                       | Hasil yang diharapkan                        |
| ---- | --------------------------------------------- | -------------------------------------------- |
| 1    | Buat BRG-004 pada A.03.01                     | Stock 0, QR dapat diunduh/cetak              |
| 2    | Aplikasi HP: IN → scan → ketik 10 → Selesai   | Stock langsung 10, histori masuk APPROVED    |
| 3    | Aplikasi HP: OUT → scan → 5 → reservasi 0012345 | Stock 5; no reservasi tampil di dashboard  |
| 4    | Ketik huruf pada jumlah/no reservasi          | Keyboard angka; huruf tidak masuk            |
| 5    | No reservasi 6 angka                          | Ditolak: harus tepat 7 angka                 |
| 6    | Stock 3, OUT qty 5                            | Ditolak sebelum dikirim, tetap 3             |
| 7    | Scan OUT barang stok 0                        | STOK HABIS, tidak lanjut ke jumlah           |
| 8    | Stock 5, OUT 3                                | Stock 2, label merah                         |
| 9    | Buka dashboard lalu transaksi dari HP         | Stok & tabel reservasi berubah tanpa refresh (~1 detik) |
| 10   | Buat barang baru di A.01.01 yang terpakai     | Pesan posisi sudah digunakan                 |
| 11   | Jalankan integration rollback trigger         | Stock dan transaction sama-sama rollback     |

Periksa juga izin kamera ditolak, sertifikat HTTPS, senter, getaran, print label fisik, login/logout, dan reconnect Wi-Fi. Automasi server tidak membuktikan kompatibilitas kamera/sertifikat pada HP tertentu.

## Troubleshooting

| Masalah                               | Penanganan                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL tidak terkoneksi / ECONNREFUSED | Start MySQL Laragon; periksa host/port `.env.local`; cek log terminal Next.js.                                                                          |
| Port 3306 bentrok                     | Hentikan service MySQL lain atau ganti port Laragon dan `DB_PORT`.                                                                                      |
| Access denied                         | Cocokkan username/password dan izin host MySQL; restart Next setelah ubah env.                                                                          |
| Table/database tidak ditemukan        | Import seluruh `database.sql`; pastikan `DB_NAME=warehouse_stock`.                                                                                      |
| Import ulang gagal table exists       | Script untuk DB baru. Jangan drop database operasional; pakai database test terpisah.                                                                   |
| HP tidak bisa buka IP                 | Pastikan satu Wi-Fi, IPv4 benar, server bind 0.0.0.0, tanpa AP isolation/VPN.                                                                           |
| Firewall memblokir                    | Izinkan TCP 3000 pada profil Private dan LocalSubnet; jangan membuka semua port.                                                                        |
| INVALID_ORIGIN                        | Masukkan origin lengkap termasuk http/https, IP/hostname, port, tanpa slash akhir ke ALLOWED_ORIGINS. Restart.                                          |
| Login kembali terus                   | Cocokkan COOKIE_SECURE dengan HTTPS; login ulang di origin HP. Cookie localhost dan IP berbeda.                                                         |
| Kamera permission denied              | Izinkan kamera untuk Warehouse Scanner di Pengaturan HP → Aplikasi; tutup aplikasi lain yang memakai kamera.                                            |
| MediaDevices tidak tersedia           | IP HTTP bukan secure context. Pasang dan trust CA lokal, gunakan HTTPS.                                                                                 |
| Sertifikat invalid                    | Pastikan IP ada di SAN sertifikat, CA dipercaya, tanggal perangkat benar, sertifikat dibuat ulang setelah IP berubah.                                   |
| QR tidak terbaca                      | Cetak cukup besar, sisakan margin putih, perbaiki cahaya/fokus. Scan QR dari halaman barang, bukan QR lain.                                             |
| QR invalid setelah regenerate         | Token lama sudah tidak berlaku; cetak ulang dan ganti label rak.                                                                                        |
| Barang masih pending                  | Approve atau cancel transaksi yang disebutkan, tidak perlu menunggu cooldown.                                                                           |
| Tidak bisa edit/nonaktifkan/adjust    | Selesaikan pending barang dahulu.                                                                                                                       |
| Realtime putus                        | Periksa jaringan/session; SSE reconnect otomatis dan polling 5s. Reverse proxy harus menonaktifkan buffering `/api/events` dan memberi timeout panjang. |
| STALE_STOCK                           | Pilih ulang barang agar stok sistem terbaru ditampilkan, periksa fisik, approve lagi.                                                                   |
| BUSY / deadlock                       | Transaksi rollback aman. Ulangi tindakan setelah proses lain selesai.                                                                                   |
| Foto ditolak                          | PNG/JPEG/WebP max 1 MB; perkecil gambar.                                                                                                                |
| Beep/vibrasi tidak terdengar          | Pilih mode lewat tap; cek silent mode. Vibration API tidak didukung semua browser.                                                                      |

## Rujukan

- [Next.js](https://nextjs.org/docs), [mysql2 prepared statements](https://sidorares.github.io/node-mysql2/docs), [shadcn/ui](https://ui.shadcn.com/docs)
- [mobile_scanner (Flutter)](https://pub.dev/packages/mobile_scanner), [mkcert](https://github.com/FiloSottile/mkcert)

### HTTP smoke test

Setelah integration test, jalankan server dengan konfigurasi database test yang sama (misalnya salin `.env.test` ke `.env.local` pada checkout test terpisah), kemudian `npm run build`, `npm start`, dan di terminal kedua `npm run test:http`. Default URL test `http://127.0.0.1:3000`; tambahkan origin ini ke `ALLOWED_ORIGINS`. Jangan jalankan terhadap database operasional. Test membuat akun/barang test, memeriksa autentikasi, Origin, validasi, QR SVG, SSE, quantity, approve, histori, CSV dan pencabutan session.
