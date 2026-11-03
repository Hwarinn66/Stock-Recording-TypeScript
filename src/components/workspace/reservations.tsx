"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { timestamp } from "@/lib/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  Reservation,
  ReservationHistoryRow,
  ReservationItem,
} from "@/types";
import { State, Pager, pill, useData } from "./shared";

const LIMIT = 10;

/** Progres & status sesi reservasi HP; reservasi lama (tanpa sesi) hanya punya jumlah barang. */
function Status({ r }: { r: ReservationHistoryRow }) {
  if (!r.status || r.total_items === null || r.taken === null)
    return <span className="text-slate-400">—</span>;
  const done = r.status === "DONE";
  const percent = Math.min(100, Math.round((r.taken / r.total_items) * 100));
  return (
    <div className="min-w-36">
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`${pill} ${done ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}
        >
          {done ? "SELESAI" : "BELUM SELESAI"}
        </span>
        <span className="font-bold">
          {r.taken}/{r.total_items}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100">
        <div
          className={`h-1.5 rounded-full ${done ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Dashboard: riwayat reservasi, satu baris per no reservasi (terbaru di atas). Klik baris
 * untuk melihat barang apa saja yang diambil. Daftar per barang tetap di Riwayat → No reservasi.
 */
export function ReservationHistory({ version }: { version: number }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string>();
  const settings = useData<{ timezone: string }>("settings");
  const timezone = settings.data?.timezone;
  const params = new URLSearchParams({
    q,
    page: String(page),
    limit: String(LIMIT),
    ...(status ? { status } : {}),
  });
  const list = useData<{ items: ReservationHistoryRow[]; total: number }>(
    "reservation-history?" + params,
    version,
  );
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
    setOpen(undefined);
  };
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Riwayat reservasi</h2>
        <Link href="/reservations" className="text-xs text-emerald-700">
          Lihat per barang di Riwayat →
        </Link>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          aria-label="Cari reservasi"
          placeholder="Cari no reservasi, kode/nama barang…"
          value={q}
          onChange={(e) => reset(() => setQ(e.target.value))}
        />
        <select
          aria-label="Filter status reservasi"
          value={status}
          onChange={(e) => reset(() => setStatus(e.target.value))}
        >
          <option value="">Semua status</option>
          <option value="OPEN">Belum selesai</option>
          <option value="DONE">Selesai</option>
        </select>
      </div>
      <State
        error={list.error}
        loading={!list.data && list.loading}
        empty={list.data?.items.length === 0}
      />
      {!!list.data?.items.length && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {[
                  "",
                  "No Reservasi",
                  "Barang Diambil",
                  "Progres / Status",
                  "Scan Terakhir",
                  "Petugas",
                ].map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((r) => {
                const expanded = open === r.reservation_number;
                const toggle = () =>
                  setOpen(expanded ? undefined : r.reservation_number);
                return (
                  <Fragment key={r.reservation_number}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={toggle}
                    >
                      <td className="w-6 text-slate-400">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`Lihat barang reservasi ${r.reservation_number}`}
                          className="grid place-items-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle();
                          }}
                        >
                          {expanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                      </td>
                      <td className="font-mono text-sm font-bold">
                        {r.reservation_number}
                      </td>
                      <td className="font-bold">{r.item_count} barang</td>
                      <td>
                        <Status r={r} />
                      </td>
                      <td>{timestamp(r.last_scan ?? r.created_at, timezone)}</td>
                      <td>{r.actors || "—"}</td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50/60 p-4">
                          <ReservationItems
                            number={r.reservation_number}
                            version={version}
                            timezone={timezone}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {list.data && list.data.total > LIMIT && (
        <Pager
          page={page}
          total={list.data.total}
          limit={LIMIT}
          onPage={(n) => {
            setPage(n);
            setOpen(undefined);
          }}
        />
      )}
    </section>
  );
}

/** Barang yang diambil untuk satu no reservasi, urut waktu scan. */
function ReservationItems({
  number,
  version,
  timezone,
}: {
  number: string;
  version: number;
  timezone?: string;
}) {
  const detail = useData<{
    session: Reservation | null;
    items: ReservationItem[];
  }>("reservation-history/" + number, version);
  if (!detail.data)
    return <State error={detail.error} loading={detail.loading} />;
  const { session, items } = detail.data;
  const outside = items.filter((i) => !i.in_session).length;
  return (
    <>
      <p className="mb-2 font-semibold">
        {session
          ? `${session.taken} dari ${session.total_items} barang sudah diambil` +
            (session.taken < session.total_items
              ? ` · kurang ${session.total_items - session.taken} barang`
              : " · selesai")
          : `${items.length} barang diambil`}
        {session && (
          <span className="ml-2 font-normal text-slate-500">
            Dimulai {timestamp(session.created_at, timezone)}
            {session.created_by_name ? ` oleh ${session.created_by_name}` : ""}
            {session.completed_at
              ? ` · selesai ${timestamp(session.completed_at, timezone)}`
              : ""}
          </span>
        )}
      </p>
      {!items.length ? (
        <p className="text-slate-500">Belum ada barang yang diambil.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr>
              {[
                "No",
                "Kode Barang",
                "Nama Barang",
                "Qty",
                "Lokasi",
                "Tanggal / Jam Scan",
                "Petugas",
                "Nomor Transaksi",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id}>
                <td>{i + 1}</td>
                <td className="font-mono">{item.sku}</td>
                <td>
                  {item.name}
                  {session && !item.in_session && (
                    <span className="ml-1 text-[10px] text-slate-400">
                      (di luar sesi HP)
                    </span>
                  )}
                </td>
                <td className="font-bold">
                  {item.quantity} {item.unit}
                </td>
                <td>{item.location_code}</td>
                <td>{timestamp(item.scanned_at, timezone)}</td>
                <td>{item.actor_name || "—"}</td>
                <td className="text-slate-500">{item.transaction_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {session && outside > 0 && (
        <p className="mt-2 text-[11px] text-slate-400">
          Barang &quot;di luar sesi HP&quot; dicatat dengan no reservasi ini dari
          aplikasi lama atau buku darurat, tidak dihitung di progres.
        </p>
      )}
    </>
  );
}
