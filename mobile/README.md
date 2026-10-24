# Warehouse Scanner (Android)

Aplikasi Flutter untuk scan QR barang di gudang. Terhubung langsung ke server web (Next.js) di komputer gudang.

## Alur di HP

1. **Login** — isi alamat server (mis. `https://10.185.200.148:3000`), username, password akun dashboard.
2. **Pilih mode** — `IN · Barang Masuk` atau `OUT · Barang Keluar`.
3. **Scan** QR pada label barang. Server langsung memeriksa barang: QR terdaftar, barang aktif, tidak ada transaksi pending, dan untuk OUT stok tidak 0.
4. **Jumlah** — keyboard angka saja (huruf/simbol ditolak, juga saat paste). Barang bersatuan Kg memakai keyboard angka dengan koma (mis. `2,5`, maks. 3 angka di belakang koma, tanpa pembulatan); satuan lain bilangan bulat. OUT tidak boleh melebihi stok.
5. **No reservasi** (khusus OUT) — tepat 7 angka. Menjadi identitas pengambilan dan divisi pengambil barang.
6. **Selesai** — stok langsung berubah di server (tanpa approval komputer). Layar hasil menampilkan nomor transaksi dan stok sebelum → sesudah. **Scan berikutnya** kembali ke kamera dengan mode yang sama.

Dashboard admin menampilkan no reservasi di tabel "No reservasi terbaru" dan menu **Riwayat → No reservasi**.

## Pasang di HP

APK hasil build ada di `build/app/outputs/flutter-apk/app-release.apk`. Salin ke HP Android (kabel USB, Google Drive, dll.), buka file-nya, izinkan "Instal dari sumber tidak dikenal", lalu pasang. Saat pertama scan, izinkan akses kamera.

HP dan komputer harus di Wi-Fi yang sama, port 3000 diizinkan di Windows Firewall (lihat README utama).

## HTTPS dan sertifikat

Server berjalan dengan `npm run dev:https` memakai sertifikat **mkcert**. Aplikasi membawa CA mkcert komputer ini (`assets/certs/rootCA.crt`, hanya sertifikat publik), jadi **tidak perlu memasang sertifikat di HP**. Syaratnya, IP yang diketik di aplikasi harus tercantum di sertifikat server (saat ini `localhost`, `127.0.0.1`, `10.185.200.148`).

Bila IP komputer berubah:

```powershell
mkcert -key-file certificates/local-key.pem -cert-file certificates/local.pem localhost 127.0.0.1 <IP-BARU>
```

lalu tambahkan `https://<IP-BARU>:3000` ke `ALLOWED_ORIGINS` di `.env.local` dan restart server. APK tidak perlu di-build ulang selama CA mkcert sama. Bila CA mkcert dibuat ulang (`mkcert -install` di komputer lain), salin `rootCA.pem` baru ke `assets/certs/rootCA.crt` lalu build ulang.

Alamat `http://...` juga diterima (mis. server `npm run dev` tanpa HTTPS).

## Build dari source

Butuh Flutter SDK dan Android SDK (Android Studio).

```powershell
cd mobile
flutter pub get
flutter test                 # unit + widget test alur jumlah/reservasi
flutter build apk --release  # → build/app/outputs/flutter-apk/app-release.apk
```

APK rilis ditandatangani dengan debug key bawaan Flutter — cukup untuk dipasang langsung (sideload) di HP gudang, bukan untuk Play Store.

## Struktur

```text
lib/main.dart                    Start aplikasi, cek sesi tersimpan
lib/api.dart                     Klien API (cookie session, HTTPS + CA mkcert), model
lib/session_store.dart           Alamat server & cookie di penyimpanan privat aplikasi
lib/validators.dart              Aturan jumlah & no reservasi (sama dengan server)
lib/screens/login_screen.dart    Login + alamat server
lib/screens/home_screen.dart     Pilih IN / OUT
lib/screens/scan_screen.dart     Kamera (mobile_scanner), senter
lib/screens/quantity_screen.dart Jumlah (keyboard angka; barang Kg boleh berkoma, maks. 3 desimal)
lib/screens/reservation_screen.dart  No reservasi 7 angka (OUT)
lib/screens/result_screen.dart   Kirim transaksi & ringkasan hasil
```

## Masalah umum

| Pesan | Solusi |
| --- | --- |
| Tidak dapat terhubung ke server | HP & komputer satu Wi-Fi, server berjalan, firewall port 3000 dibuka, alamat memakai IP komputer (bukan `localhost`). |
| Sertifikat HTTPS server tidak dipercaya | IP yang diketik tidak ada di sertifikat mkcert; buat ulang sertifikat dengan IP tersebut. |
| Respons server tidak dikenali | Alamat server salah (port/path). Contoh benar: `https://10.185.200.148:3000`. |
| Izin kamera ditolak | Pengaturan HP → Aplikasi → Warehouse Scanner → Izin → Kamera. |
| Barang masih menunggu proses | Ada transaksi pending lama; approve/batalkan di bagian Transaksi menunggu pada Dashboard web. |
