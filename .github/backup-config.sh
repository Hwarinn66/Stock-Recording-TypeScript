#!/usr/bin/env bash
# Dipakai workflow "Backup database": siapkan koneksi Aiven & kata sandi backup.
# Sumber: secret BACKUP_ENV (isi .env.aiven, baris KEY=nilai) dan/atau secret terpisah
# (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL_CA, BACKUP_PASSPHRASE; lebih diutamakan).
# Sertifikat CA Aiven (publik) diambil dari .github/aiven-ca.pem bila DB_SSL_CA tidak diisi.
# Hasil ditulis ke $GITHUB_ENV untuk langkah berikutnya; nilai rahasia disamarkan di log.
set -euo pipefail
declare -A value=()
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*(DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME|BACKUP_PASSPHRASE)[[:space:]]*=(.*)$ ]] || continue
  key="${BASH_REMATCH[1]}"
  v="${BASH_REMATCH[2]}"
  v="${v#"${v%%[![:space:]]*}"}" # buang spasi depan
  v="${v%"${v##*[![:space:]]}"}" # buang spasi belakang
  if [[ "$v" =~ ^\"(.*)\"$ || "$v" =~ ^\'(.*)\'$ ]]; then v="${BASH_REMATCH[1]}"; fi
  value[$key]="$v"
done <<<"${S_ENV:-}"
for key in DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME BACKUP_PASSPHRASE; do
  separate="S_$key"
  [ -n "${!separate:-}" ] && value[$key]="${!separate}"
done
if [ -n "${S_DB_SSL_CA:-}" ]; then
  ca="$(printf '%s\n' "$S_DB_SSL_CA" | sed 's/\\n/\n/g')"
elif [ -f .github/aiven-ca.pem ]; then
  ca="$(cat .github/aiven-ca.pem)"
else
  ca=""
fi

missing=""
for key in DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME BACKUP_PASSPHRASE; do
  [ -n "${value[$key]:-}" ] || missing="$missing $key"
done
[ -n "$ca" ] || missing="$missing DB_SSL_CA"
if [ -n "$missing" ]; then
  echo "::error::Belum diisi:$missing. Buat secret BACKUP_ENV berisi seluruh isi .env.aiven (termasuk baris BACKUP_PASSPHRASE) di Settings → Secrets and variables → Actions."
  exit 1
fi
if [ "${#value[BACKUP_PASSPHRASE]}" -lt 16 ]; then
  echo "::error::BACKUP_PASSPHRASE minimal 16 karakter."
  exit 1
fi
[[ "${value[DB_PORT]}" =~ ^[0-9]+$ ]] || { echo "::error::DB_PORT harus angka."; exit 1; }
grep -q "BEGIN CERTIFICATE" <<<"$ca" || { echo "::error::DB_SSL_CA bukan sertifikat PEM."; exit 1; }

for key in DB_HOST DB_USER DB_PASSWORD BACKUP_PASSPHRASE; do
  echo "::add-mask::${value[$key]}"
done
put() { { echo "$1<<__END_$1__"; printf '%s\n' "$2"; echo "__END_$1__"; } >>"$GITHUB_ENV"; }
put DB_HOST "${value[DB_HOST]}"
put DB_PORT "${value[DB_PORT]}"
put DB_USER "${value[DB_USER]}"
put DB_NAME "${value[DB_NAME]}"
put MYSQL_PWD "${value[DB_PASSWORD]}"
put BACKUP_PASSPHRASE "${value[BACKUP_PASSPHRASE]}"
put DB_SSL_CA "$ca"
echo "Konfigurasi backup lengkap (port ${value[DB_PORT]})."
