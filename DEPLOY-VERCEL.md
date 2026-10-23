# Online gratis: Vercel + Aiven

Web dijalankan di **Vercel** (paket Hobby) dan database MySQL di **Aiven** (paket Free).
Kode sudah disesuaikan: koneksi database memakai TLS, koneksi ditutup sebelum server
Vercel "tidur", dan dashboard di Vercel mengecek perubahan stok **setiap 15 detik**
(di PC/VPS sendiri tetap realtime).

> **Batasan paket gratis**
>
> - Vercel Hobby resminya hanya untuk pemakaian pribadi/non-komersial. Untuk pemakaian
>   perusahaan jangka panjang, pertimbangkan Vercel Pro atau VPS.
> - Kuota Vercel per bulan: 360 GB-jam memori, 4 jam CPU, 1 juta request. Pantau di
>   **Vercel → project → Usage**.
> - Aiven Free: 1 CPU, 1 GB RAM, **disk 1 GB** (foto barang paling cepat memenuhinya),
>   maksimal 76 koneksi, tanpa SLA/support, dan **dimatikan bila lama tidak dipakai**
>   (ada email pemberitahuan; nyalakan lagi lewat console).
> - Karena tanpa jaminan, **backup database rutin** (lihat bagian akhir).

## 1. Database Aiven

1. Daftar di <https://console.aiven.io/signup> (gratis, tanpa kartu kredit).
2. **Create service → MySQL → plan Free**. Bila ada pilihan region, pilih yang paling
   dekat dengan Indonesia (Singapura). **Catat region-nya.**
3. Tunggu status **Running**.
4. Di halaman **Overview → Connection information**, catat **Host**, **Port**, **User**
   (`avnadmin`) dan **Password**. Klik **CA certificate → Download** dan simpan file itu
   sebagai `certificates\aiven-ca.pem` di folder proyek.
5. Buka file `.env.aiven` di folder proyek, isi `DB_HOST`, `DB_PORT`, dan `DB_PASSWORD`.
   File ini tidak ikut ke GitHub.

### Pindahkan data dari PC ke Aiven (sekali saja)

Jalankan di PowerShell dari folder proyek. Ganti `HOST` dan `PORT` dengan data Aiven;
password akan ditanyakan saat perintah kedua berjalan.

```powershell
$bin = "C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin"
& "$bin\mysqldump.exe" -uroot --single-transaction --set-gtid-purged=OFF --no-tablespaces --default-character-set=utf8mb4 --result-file=warehouse_stock-cloud.sql warehouse_stock
& "$bin\mysql.exe" -h HOST -P PORT -u avnadmin -p --ssl-mode=VERIFY_CA --ssl-ca=certificates\aiven-ca.pem --default-character-set=utf8mb4 -e "CREATE DATABASE IF NOT EXISTS warehouse_stock CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE warehouse_stock; SOURCE warehouse_stock-cloud.sql;"
Remove-Item warehouse_stock-cloud.sql
```

Semua barang, stok, lokasi, histori, dan akun ikut pindah.

## 2. Kode ke GitHub

Vercel mengambil kode dari repo GitHub `Hwarinn66/Stock-Recording-TypeScript`. Pastikan
perubahan terbaru sudah di-commit dan di-push ke branch `main`. File `.env*` dan folder
`certificates/` tidak ikut terunggah.

## 3. Vercel

1. Daftar di <https://vercel.com/signup> → **Continue with GitHub** (akun yang memiliki repo),
   pilih paket **Hobby**.
2. **Add New… → Project → Import** repo `Stock-Recording-TypeScript`. Framework terdeteksi
   otomatis (Next.js); build command tidak perlu diubah.
3. Buka **Environment Variables** dan isi:

   | Nama              | Isi                                                                                        |
   | ----------------- | ------------------------------------------------------------------------------------------ |
   | `DB_HOST`         | Host Aiven                                                                                 |
   | `DB_PORT`         | Port Aiven                                                                                 |
   | `DB_USER`         | `avnadmin`                                                                                 |
   | `DB_PASSWORD`     | Password Aiven                                                                             |
   | `DB_NAME`         | `warehouse_stock`                                                                          |
   | `DB_SSL_CA`       | Seluruh isi `certificates\aiven-ca.pem` (buka dengan Notepad → Ctrl+A → Ctrl+C), termasuk baris `BEGIN`/`END` |
   | `APP_TIMEZONE`    | `Asia/Jakarta`                                                                             |
   | `SESSION_HOURS`   | `12`                                                                                       |
   | `COOKIE_SECURE`   | `true`                                                                                     |
   | `APP_URL`         | `https://NAMA-PROJECT.vercel.app`                                                          |
   | `ALLOWED_ORIGINS` | `https://NAMA-PROJECT.vercel.app`                                                          |

4. Klik **Deploy**. Setelah selesai, Vercel menampilkan alamat web. Bila alamatnya berbeda
   dari `APP_URL`, ubah `APP_URL` dan `ALLOWED_ORIGINS` di **Settings → Environment
   Variables**, lalu **Deployments → ⋯ → Redeploy**.
5. Region server Vercel diatur di `vercel.json` (`sin1` = Singapura). Bila database Aiven
   berada di region lain, ganti ke region Vercel yang paling dekat dengan Aiven agar tidak
   lambat (daftar region: <https://vercel.com/docs/regions>).

## 4. Setelah online

1. **Ganti password admin** (web kini bisa dibuka dari internet):

   ```powershell
   npm run cloud:password -- admin "PasswordBaruYangKuat"
   ```

2. **Aplikasi HP:** Logout → isi alamat server `https://NAMA-PROJECT.vercel.app` → login.
   Tidak perlu install APK baru; sertifikat HTTPS Vercel otomatis dipercaya HP.
3. Mulai saat ini pakai **versi online saja**. Database di PC lokal tidak ikut berubah,
   jadi data keduanya akan berbeda.

## Backup rutin (disarankan seminggu sekali)

```powershell
$bin = "C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin"
& "$bin\mysqldump.exe" -h HOST -P PORT -u avnadmin -p --ssl-mode=VERIFY_CA --ssl-ca=certificates\aiven-ca.pem --single-transaction --set-gtid-purged=OFF --no-tablespaces --default-character-set=utf8mb4 --result-file="backup-$(Get-Date -Format yyyyMMdd).sql" warehouse_stock
```

## Masalah umum

| Gejala                                    | Penyebab / solusi                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| "Origin belum diizinkan"                  | `APP_URL`/`ALLOWED_ORIGINS` tidak sama persis dengan alamat web. Perbaiki lalu Redeploy.               |
| Error koneksi / `HANDSHAKE_SSL_ERROR`     | `DB_SSL_CA` tidak lengkap atau salah file. Tempel ulang seluruh isi `aiven-ca.pem`.                    |
| `ECONNREFUSED` / timeout ke database      | Service Aiven sedang mati (tidak aktif). Buka console Aiven → **Power on**.                            |
| "Too many connections"                    | Tambahkan env `DB_CONNECTION_LIMIT=3` di Vercel lalu Redeploy.                                         |
| Web terasa lambat                         | Region Vercel (`vercel.json`) dan Aiven berjauhan.                                                     |
| Web berhenti di akhir bulan               | Kuota Vercel habis. Cek **Usage**; tunggu reset bulanan atau upgrade.                                  |
| Dashboard terlambat update                | Normal di Vercel: dicek tiap 15 detik. Bisa diubah dengan env `LIVE_POLL_SECONDS` (makin kecil makin boros kuota). |
