import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { db, eventRevision } from "../src/lib/db";
import { toBuffer } from "../src/lib/excel";
import {
  buildBackupWorkbook,
  loadBackupData,
} from "../src/services/excel-backup";
import {
  buildEmergencyTemplate,
  emergencyCatalog,
} from "../src/services/emergency";

// Cadangan Excel otomatis di komputer ini. Program memeriksa database setiap beberapa
// detik; bila ada perubahan (barang masuk/keluar, edit barang, dst.) file
// stok-gudang.xlsx ditulis ulang. Database dibaca langsung, jadi tetap berjalan
// walaupun website (Vercel) sedang error. Arah data hanya database → Excel.
const usage = `Gunakan:
  npm run excel:backup         (database lokal, .env.local)
  npm run excel:backup:cloud   (database Aiven, .env.aiven)
Opsi: --once = tulis sekali lalu berhenti.
Pengaturan .env (opsional): EXCEL_BACKUP_DIR (folder), EXCEL_BACKUP_SECONDS (detik antar-cek, default 3),
EXCEL_HISTORY_DAYS (riwayat berapa hari, default 90).`;
if (process.argv.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
function defaultDir() {
  const home = homedir();
  const desktop = [
    join(home, "Desktop"),
    join(home, "OneDrive", "Desktop"),
  ].find(existsSync);
  return join(desktop ?? home, "Backup Gudang");
}
const dir = process.env.EXCEL_BACKUP_DIR?.trim() || defaultDir();
const backupFile = join(dir, "stok-gudang.xlsx");
const emergencyFile = join(dir, "buku-darurat.xlsx");
const interval =
  Math.max(2, Number(process.env.EXCEL_BACKUP_SECONDS) || 3) * 1000;
// Tetap ditulis ulang sesekali walau tidak ada perubahan, agar jam "Per ..." di file
// menunjukkan program masih berjalan.
const heartbeat = 15 * 60 * 1000;
const once = process.argv.includes("--once");

const time = () =>
  new Intl.DateTimeFormat("id-ID", {
    timeStyle: "medium",
    timeZone: process.env.APP_TIMEZONE || "Asia/Jakarta",
  }).format(new Date());
let lastMessage = "";
/** Pesan yang sama tidak diulang setiap detik (mis. file masih dibuka di Excel). */
function log(message: string, repeat = false) {
  if (!repeat && message === lastMessage) return;
  lastMessage = message;
  console.log(`[${time()}] ${message}`);
}
const locked = (error: unknown) =>
  ["EBUSY", "EPERM", "EACCES"].includes(
    (error as NodeJS.ErrnoException).code ?? "",
  );

/**
 * Tulis ke file sementara lalu ganti sekaligus: file tidak pernah setengah jadi.
 * File diberi atribut read-only: Excel membukanya sebagai "Read-Only" (cadangan tidak
 * untuk diedit) tanpa mengunci file, sehingga tetap bisa diganti walau sedang dibuka.
 * Bila file dibuka dalam mode edit, Windows menolak penggantian; dicoba lagi berikutnya.
 */
function replaceFile(file: string, data: Buffer) {
  const temp = join(dir, `.~${process.pid}.tmp`);
  writeFileSync(temp, data);
  try {
    if (existsSync(file)) chmodSync(file, 0o666);
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  } finally {
    if (existsSync(file)) chmodSync(file, 0o444);
  }
}
async function writeBackup() {
  const data = await loadBackupData();
  replaceFile(backupFile, await toBuffer(buildBackupWorkbook(data)));
  return data;
}
/** Buku darurat dibuat sekali bila belum ada; file yang sudah diisi petugas tidak pernah ditimpa. */
async function ensureEmergencyBook() {
  if (existsSync(emergencyFile)) return;
  writeFileSync(
    emergencyFile,
    await buildEmergencyTemplate(await emergencyCatalog()),
  );
  log(`Buku darurat dibuat: ${emergencyFile}`, true);
}

let last = "";
let dirty = true;
let writtenAt = 0;
async function tick() {
  try {
    const { revision } = await eventRevision();
    if (revision !== last) dirty = true;
    if (dirty || Date.now() - writtenAt > heartbeat) {
      // Revisi dicatat sebelum data dibaca: perubahan di tengah pembacaan memicu tulis ulang berikutnya.
      last = revision;
      try {
        const data = await writeBackup();
        dirty = false;
        writtenAt = Date.now();
        log(
          `Diperbarui: ${data.products.length} barang, ${data.history.length} transaksi (${data.days} hari) → ${backupFile}`,
          true,
        );
      } catch (error) {
        if (!locked(error)) throw error;
        log(
          "File stok-gudang.xlsx sedang dibuka di Excel (mode edit). Tutup file agar bisa diperbarui (dicoba lagi otomatis)...",
        );
      }
    }
    await ensureEmergencyBook();
  } catch (error) {
    log(
      `Database tidak terjangkau atau error: ${(error as Error).message}. File terakhir tetap tersedia; dicoba lagi otomatis...`,
    );
  }
}

mkdirSync(dir, { recursive: true });
log(`Backup Excel aktif. Folder: ${dir}`, true);
if (once) {
  await tick();
  await db.end();
} else {
  log(
    `Memeriksa perubahan setiap ${interval / 1000} detik. Biarkan jendela ini terbuka; tekan Ctrl+C untuk berhenti.`,
    true,
  );
  const loop = async () => {
    await tick();
    setTimeout(loop, interval);
  };
  void loop();
  process.on("SIGINT", async () => {
    log("Backup Excel dihentikan.", true);
    await db.end();
    process.exit(0);
  });
}
