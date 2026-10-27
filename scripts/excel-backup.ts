import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
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
import {
  LIVE_DATA_DIR,
  LIVE_FILE,
  liveCsvFiles,
  liveRefreshScript,
  liveWorkbookScript,
} from "../src/services/excel-live";

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
const liveFile = join(dir, LIVE_FILE);
const liveDir = join(dir, LIVE_DATA_DIR);
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
function replaceFile(file: string, data: Buffer | string, readOnly = true) {
  const temp = `${file}.~${process.pid}.tmp`;
  writeFileSync(temp, data);
  try {
    if (readOnly && existsSync(file)) chmodSync(file, 0o666);
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  } finally {
    if (readOnly && existsSync(file)) chmodSync(file, 0o444);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const powershell = (args: string[]) => [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  ...args,
];
const encoded = (script: string) =>
  Buffer.from(script, "utf16le").toString("base64");
let liveUnavailable = false;
/**
 * Workbook live: CSV di folder _data ditulis ulang, workbook dibuat sekali (butuh
 * Microsoft Excel), lalu Excel yang sedang membukanya diminta refresh saat itu juga.
 */
async function writeLive(data: Awaited<ReturnType<typeof loadBackupData>>) {
  mkdirSync(liveDir, { recursive: true });
  for (const [name, content] of Object.entries(liveCsvFiles(data))) {
    // Power Query bisa sedang membaca CSV: coba beberapa kali.
    for (let attempt = 0; ; attempt++) {
      try {
        replaceFile(join(liveDir, name), content, false);
        break;
      } catch (error) {
        if (!locked(error) || attempt >= 10) throw error;
        await sleep(300);
      }
    }
  }
  if (process.platform !== "win32" || liveUnavailable) return;
  if (!existsSync(liveFile)) {
    log(
      "Membuat stok-gudang-live.xlsx lewat Microsoft Excel (sekali saja)...",
      true,
    );
    // BOM agar Windows PowerShell membaca path non-ASCII dengan benar.
    const script = join(tmpdir(), `warehouse-live-${process.pid}.ps1`);
    writeFileSync(script, "﻿" + liveWorkbookScript(dir));
    const result = spawnSync("powershell.exe", powershell(["-File", script]), {
      timeout: 180000,
      windowsHide: true,
      encoding: "utf8",
    });
    unlinkSync(script);
    if (result.status !== 0 || !existsSync(liveFile)) {
      liveUnavailable = true;
      log(
        `stok-gudang-live.xlsx tidak bisa dibuat (Microsoft Excel diperlukan): ${(result.stderr || result.error?.message || "").trim().split("\n")[0]}`,
        true,
      );
      return;
    }
    log(`Dibuat: ${liveFile} — buka file ini, angkanya berubah sendiri.`, true);
    return;
  }
  spawn(
    "powershell.exe",
    powershell(["-EncodedCommand", encoded(liveRefreshScript)]),
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  ).unref();
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
let lastLive = "";
let dirty = true;
let writtenAt = 0;
async function tick() {
  try {
    const { revision } = await eventRevision();
    if (revision !== last) dirty = true;
    if (dirty || Date.now() - writtenAt > heartbeat) {
      // Revisi dicatat sebelum data dibaca: perubahan di tengah pembacaan memicu tulis ulang berikutnya.
      last = revision;
      const data = await loadBackupData();
      if (revision !== lastLive) {
        await writeLive(data);
        lastLive = revision;
      }
      try {
        replaceFile(backupFile, await toBuffer(buildBackupWorkbook(data)));
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
