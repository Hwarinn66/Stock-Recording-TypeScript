@echo off
rem Klik dua kali untuk menjalankan Backup Excel gudang.
rem Agar otomatis jalan saat komputer menyala: tekan Win+R, ketik shell:startup,
rem lalu buat shortcut file ini di folder tersebut.
title Backup Excel Gudang
cd /d "%~dp0.."
if exist ".env.aiven" (
  call npm run excel:backup:cloud
) else (
  call npm run excel:backup
)
pause
