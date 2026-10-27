"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { api, timestamp, write } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { pill, useData } from "./shared";
type Status = "ready" | "saved" | "imported" | "conflict" | "error";
type Row = {
  no: number;
  date: string | null;
  time: string | null;
  type: "IN" | "OUT" | null;
  sku: string;
  name: string | null;
  unit: string | null;
  quantity: number | null;
  reservation: string | null;
  officer: string;
  status: Status;
  message: string;
  stock_before: number | null;
  stock_after: number | null;
};
type Result = {
  rows: Row[];
  summary: Record<Status, number> & { total: number };
};
const xlsx =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const statusText: Record<Status, string> = {
  ready: "Siap disimpan",
  saved: "Tersimpan",
  imported: "Sudah tersimpan",
  conflict: "Isi berbeda",
  error: "Bermasalah",
};
const statusStyle: Record<Status, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  saved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  imported: "bg-slate-100 text-slate-500 ring-slate-200",
  conflict: "bg-amber-50 text-amber-700 ring-amber-200",
  error: "bg-red-50 text-red-700 ring-red-200",
};
function when(row: Row) {
  if (!row.date) return "—";
  const [y, m, d] = row.date.split("-").map(Number);
  const day = new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${day} ${row.time ?? ""}`;
}
/**
 * Excel live: file yang diunduh sekali di PC mana pun, lalu mengambil data sendiri
 * dari web tiap menit. Kunci akses baca-saja bisa dicabut semuanya dari sini.
 */
function LiveExcelCard() {
  const status = useData<{ active: number; last_used_at: string | null }>(
    "excel-live/status",
  );
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    if (
      !confirm(
        "Cabut akses semua file Excel live yang sudah diunduh? File itu berhenti mendapat data; unduh ulang untuk memakai lagi.",
      )
    )
      return;
    setBusy(true);
    try {
      await write("excel-live/revoke");
      toast.success("Akses Excel live dicabut");
      await status.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const active = status.data?.active ?? 0;
  return (
    <Card className="flex flex-col">
      <h3 className="flex items-center gap-2 font-bold">
        <FileSpreadsheet className="size-4 text-emerald-600" />
        Excel live
      </h3>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-slate-500">
        <li>Unduh file di PC mana pun (cukup sekali per PC).</li>
        <li>
          Buka di Excel, klik <b>Enable Editing</b> lalu <b>Enable Content</b>.
        </li>
        <li>
          Biarkan terbuka: stok & riwayat diambil sendiri dari web tiap 1 menit
          dan setiap file dibuka. Tidak perlu laptop atau program lain.
        </li>
      </ol>
      <p className="mt-3 text-xs text-slate-400">
        {active
          ? `${active} file aktif · terakhir mengambil data ${timestamp(status.data?.last_used_at)}`
          : "Belum ada file Excel live yang aktif."}{" "}
        File berisi kunci baca-saja: siapa pun yang memegangnya bisa melihat
        stok.
      </p>
      <div className="mt-auto grid gap-2 pt-4 sm:grid-cols-2">
        <Button asChild>
          <a
            href="/api/excel-live"
            onClick={() => setTimeout(() => void status.reload(), 3000)}
          >
            <Download />
            Unduh Excel live
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href="/api/backup/excel" title="Potret sesaat, tidak ikut berubah">
            <Download />
            Unduh cadangan sekali
          </a>
        </Button>
      </div>
      {active > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={revoke}
          className="mt-3 self-start text-xs text-red-700 hover:underline"
        >
          Cabut akses semua file Excel live
        </button>
      )}
    </Card>
  );
}
/** Cadangan Excel (unduh) dan buku darurat (unduh template, unggah, pratinjau, simpan). */
export function ExcelTools() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState<Result>();
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = (action: "preview" | "apply", f: File) =>
    api<Result>("emergency/" + action, {
      method: "POST",
      body: f,
      headers: { "Content-Type": xlsx },
    });
  const preview = async (f: File) => {
    setFile(f);
    setResult(undefined);
    setApplied(false);
    setBusy(true);
    try {
      setResult(await send("preview", f));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const apply = async () => {
    if (!file || !result) return;
    if (
      !confirm(
        `Simpan ${result.summary.ready} transaksi dari buku darurat? Stok barang akan berubah.`,
      )
    )
      return;
    setBusy(true);
    try {
      const saved = await send("apply", file);
      setResult(saved);
      setApplied(true);
      toast.success(`${saved.summary.saved} transaksi tersimpan`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const s = result?.summary;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <LiveExcelCard />
        <Card className="flex flex-col">
          <h3 className="font-bold">Buku darurat</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-slate-500">
            <li>
              Simpan template di komputer gudang sebelum dibutuhkan (program
              Backup Excel juga membuatnya otomatis).
            </li>
            <li>
              Saat web atau HP tidak bisa dipakai, catat barang masuk/keluar di
              file itu.
            </li>
            <li>
              Setelah web normal, unggah file di sini. Baris yang sudah
              tersimpan tidak dicatat dua kali, jadi file yang sama boleh
              diunggah ulang.
            </li>
          </ol>
          <div className="mt-auto grid gap-2 pt-4 sm:grid-cols-2">
            <Button asChild variant="outline">
              <a href="/api/emergency/template">
                <Download />
                Unduh template buku darurat
              </a>
            </Button>
            <Button disabled={busy} onClick={() => input.current?.click()}>
              <Upload />
              {busy && !result ? "Membaca file…" : "Unggah buku darurat"}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              aria-label="File buku darurat"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void preview(f);
              }}
            />
          </div>
        </Card>
      </div>
      {result && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
            <div>
              <p className="font-semibold">
                {applied ? "Hasil penyimpanan" : "Pratinjau"} · {file?.name}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(
                  [
                    "ready",
                    "saved",
                    "imported",
                    "conflict",
                    "error",
                  ] as Status[]
                )
                  .filter((k) => s![k] > 0)
                  .map((k) => (
                    <span key={k} className={`${pill} ${statusStyle[k]}`}>
                      {statusText[k]}: {s![k]}
                    </span>
                  ))}
                {s!.total === 0 && (
                  <span className="text-sm text-slate-500">
                    Belum ada baris yang diisi.
                  </span>
                )}
              </div>
            </div>
            {!applied && (
              <Button disabled={busy || !s!.ready} onClick={apply}>
                {busy ? "Menyimpan…" : `Simpan ${s!.ready} transaksi`}
              </Button>
            )}
          </div>
          {!!result.rows.length && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {[
                      "No",
                      "Status",
                      "Waktu",
                      "Jenis",
                      "Kode Barang",
                      "Nama Barang",
                      "Jumlah",
                      "No Reservasi",
                      "Petugas",
                      "Stok",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.no}>
                      <td>{r.no}</td>
                      {/* Status & alasannya di depan: baris bermasalah langsung terlihat. */}
                      <td className="min-w-56 max-w-80 whitespace-normal">
                        <span className={`${pill} ${statusStyle[r.status]}`}>
                          {statusText[r.status]}
                        </span>
                        {r.status !== "ready" && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            {r.message}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{when(r)}</td>
                      <td>
                        {r.type === "IN"
                          ? "Masuk"
                          : r.type === "OUT"
                            ? "Keluar"
                            : "—"}
                      </td>
                      <td className="font-mono">{r.sku || "—"}</td>
                      <td>{r.name ?? "—"}</td>
                      <td className="whitespace-nowrap font-semibold">
                        {r.quantity ?? "—"} {r.unit ?? ""}
                      </td>
                      <td className="font-mono">{r.reservation ?? "—"}</td>
                      <td>{r.officer || "—"}</td>
                      <td className="whitespace-nowrap">
                        {r.stock_before !== null
                          ? `${r.stock_before} → ${r.stock_after}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
