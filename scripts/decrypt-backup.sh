#!/usr/bin/env bash
# Buka file backup harian dari GitHub Actions menjadi file .sql yang bisa dipulihkan.
# Jalankan di Git Bash:  bash scripts/decrypt-backup.sh <file .zip atau .sql.gz.gpg>
# Kata sandi = BACKUP_PASSPHRASE yang diisi di GitHub Secrets (diketik, tidak tampil).
set -euo pipefail
input="${1:-}"
if [ -z "$input" ] || [ ! -f "$input" ]; then
  echo "Gunakan: bash scripts/decrypt-backup.sh <warehouse_stock-YYYYMMDD-HHMM.sql.gz.gpg atau .zip>" >&2
  exit 1
fi
dir=$(cd "$(dirname "$input")" && pwd)
# Unduhan dari tab Actions berupa .zip berisi satu file .gpg.
if [[ "$input" == *.zip ]]; then
  gpgfile=$(unzip -Z1 "$input" | grep '\.gpg$' | head -n 1)
  [ -n "$gpgfile" ] || { echo "Tidak ada file .gpg di dalam $input" >&2; exit 1; }
  unzip -o -q "$input" "$gpgfile" -d "$dir"
  input="$dir/$gpgfile"
fi
output="${input%.gz.gpg}"
[ "$output" != "$input" ] || output="$input.sql"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  passphrase="$BACKUP_PASSPHRASE"
else
  read -r -s -p "Kata sandi backup: " passphrase
  echo
fi
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$input" 3<<<"$passphrase" \
  | gunzip > "$output.tmp" || { rm -f "$output.tmp"; echo "Gagal membuka: kata sandi salah atau file rusak." >&2; exit 1; }
tail -n 1 "$output.tmp" | grep -q "Dump completed" || { rm -f "$output.tmp"; echo "Isi backup tidak lengkap." >&2; exit 1; }
mv "$output.tmp" "$output"
# Tampilkan lokasi dalam format Windows bila dijalankan di Git Bash.
shown=$(command -v cygpath >/dev/null && cygpath -w "$output" || echo "$output")
echo "Selesai: $shown ($(wc -c < "$output") byte)"
echo "Pulihkan: lihat README bagian \"Backup otomatis\"."
