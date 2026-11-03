"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { timestamp } from "@/lib/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Batch, BatchHistoryRow, BatchItem } from "@/types";
import { State, Pager, pill, useData } from "./shared";

const LIMIT = 10;

/** Riwayat sesi scan HP di dashboard: barang keluar per no reservasi, barang masuk per kode masuk. */
type Kind = {
  api: "reservation-history" | "receipt-history";
  title: string;
  /** "reservasi" / "kode masuk" dalam teks. */
  noun: string;
  codeHeader: string;
  /** Barang "diambil" / "masuk". */
  verb: string;
  /** Daftar per barang di halaman Riwayat. */
  href: string;
};

const RESERVATIONS: Kind = {
  api: "reservation-history",
  title: "Riwayat reservasi",
  noun: "reservasi",
  codeHeader: "No Reservasi",
  verb: "diambil",
  href: "/reservations",
};

const RECEIPTS: Kind = {
  api: "receipt-history",
  title: "Riwayat penerimaan (barang masuk)",
  noun: "kode masuk",
  codeHeader: "Kode Masuk",
  verb: "masuk",
  href: "/history/in",
};

/** Progres & status sesi HP; data lama (tanpa sesi) hanya punya jumlah barang. */
function Status({ r }: { r: BatchHistoryRow }) {
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

/** Dashboard: riwayat reservasi (barang keluar). Klik baris untuk melihat barang yang diambil. */
export const ReservationHistory = ({ version }: { version: number }) => (
  <BatchHistory kind={RESERVATIONS} version={version} />
);

/** Dashboard: riwayat penerimaan (barang masuk) per kode masuk. Klik baris untuk melihat barangnya. */
export const ReceiptHistory = ({ version }: { version: number }) => (
  <BatchHistory kind={RECEIPTS} version={version} />
);

/**
 * Satu baris per kode (terbaru di atas). Klik baris untuk melihat barangnya. Daftar per
 * barang tetap di halaman Riwayat.
 */
function BatchHistory({ kind, version }: { kind: Kind; version: number }) {
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
  const list = useData<{ items: BatchHistoryRow[]; total: number }>(
    `${kind.api}?${params}`,
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
        <h2 className="text-lg font-bold">{kind.title}</h2>
        <Link href={kind.href} className="text-xs text-emerald-700">
          Lihat per barang di Riwayat →
        </Link>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          aria-label={`Cari ${kind.noun}`}
          placeholder={`Cari ${kind.noun}, kode/nama barang…`}
          value={q}
          onChange={(e) => reset(() => setQ(e.target.value))}
        />
        <select
          aria-label={`Filter status ${kind.noun}`}
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
                  kind.codeHeader,
                  `Barang ${kind.verb === "diambil" ? "Diambil" : "Masuk"}`,
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
                const expanded = open === r.code;
                const toggle = () => setOpen(expanded ? undefined : r.code);
                return (
                  <Fragment key={r.code}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={toggle}
                    >
                      <td className="w-6 text-slate-400">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`Lihat barang ${kind.noun} ${r.code}`}
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
                      <td className="font-mono text-sm font-bold">{r.code}</td>
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
                          <BatchItems
                            kind={kind}
                            code={r.code}
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

/** Barang yang tercatat dengan satu kode, urut waktu scan. */
function BatchItems({
  kind,
  code,
  version,
  timezone,
}: {
  kind: Kind;
  code: string;
  version: number;
  timezone?: string;
}) {
  const detail = useData<{ session: Batch | null; items: BatchItem[] }>(
    `${kind.api}/${encodeURIComponent(code)}`,
    version,
  );
  if (!detail.data)
    return <State error={detail.error} loading={detail.loading} />;
  const { session, items } = detail.data;
  const outside = items.filter((i) => !i.in_session).length;
  return (
    <>
      <p className="mb-2 font-semibold">
        {session
          ? `${session.taken} dari ${session.total_items} barang sudah ${kind.verb}` +
            (session.taken < session.total_items
              ? ` · kurang ${session.total_items - session.taken} barang`
              : " · selesai")
          : `${items.length} barang ${kind.verb}`}
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
        <p className="text-slate-500">Belum ada barang yang {kind.verb}.</p>
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
          Barang &quot;di luar sesi HP&quot; dicatat dengan {kind.noun} ini dari
          aplikasi lama atau buku darurat, tidak dihitung di progres.
        </p>
      )}
    </>
  );
}
