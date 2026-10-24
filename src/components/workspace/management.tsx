"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";
import { write, timestamp } from "@/lib/client";
import { allowsDecimal, correction, roundStock, validAmount } from "@/lib/stock";
import { useLive } from "@/hooks/use-live";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  InventoryProduct,
  Lookup,
  Product,
  LocationLookup,
  StockTransaction,
} from "@/types";
import { Heading, State, Badge, Pager, Tabs, useData } from "./shared";
type HistoryType = "all" | "in" | "out" | "adjustments" | "reservations";
export function HistoryPage({
  type,
  productId,
  compact = false,
  bare = false,
  editable = false,
}: {
  type: HistoryType;
  productId?: number;
  compact?: boolean;
  /** Tanpa judul, untuk dipasang di bawah tab halaman Riwayat. */
  bare?: boolean;
  /** Nama barang bisa diklik untuk merevisi jumlah / no reservasi. */
  editable?: boolean;
}) {
  const [editing, setEditing] = useState<StockTransaction>();
  const showReservation = type === "out" || type === "reservations";
  const { version } = useLive();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => {
    // Tautan dari dashboard, mis. /history/in?from=2026-10-24&to=2026-10-24.
    const params = new URLSearchParams(location.search);
    const date = (key: string) => {
      const value = params.get(key) ?? "";
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
    };
    setFrom(date("from"));
    setTo(date("to"));
  }, []);
  const [rack, setRack] = useState("");
  const [product, setProduct] = useState(productId ? String(productId) : "");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("scanned_at");
  const [direction, setDirection] = useState("desc");
  const locations = useData<LocationLookup[]>("locations");
  const products = useData<{ items: InventoryProduct[] }>(
    "products?active=all&limit=100&q=" + encodeURIComponent(q),
  );
  const settings = useData<{ timezone: string }>("settings");
  const params = new URLSearchParams({
    q,
    page: String(page),
    sort,
    direction,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(rack ? { location_id: rack } : {}),
    ...(product ? { product_id: product } : {}),
    ...(status ? { status } : {}),
  });
  const list = useData<{ items: StockTransaction[]; total: number }>(
    "history/" + type + "?" + params,
    version,
  );
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const title =
    type === "all"
      ? "Semua transaksi"
      : type === "in"
      ? "Riwayat barang masuk"
      : type === "out"
        ? "Riwayat barang keluar"
        : type === "reservations"
          ? "Nomor reservasi"
          : "Riwayat koreksi stok";
  return (
    <section>
      {bare ? null : compact ? (
        <h2 className="font-bold text-lg mb-4">{title}</h2>
      ) : (
        <Heading
          title={title}
          description={
            type === "reservations"
              ? "Barang keluar dari aplikasi scanner HP. No reservasi adalah identitas pengambilan dan divisi pengambil barang. Klik nama barang untuk merevisi jumlah atau no reservasi."
              : "Jejak transaksi lengkap, termasuk transaksi yang dibatalkan."
          }
        />
      )}
      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          className="max-w-xs"
          aria-label="Cari histori"
          placeholder={
            showReservation
              ? "Cari no reservasi, transaksi, barang, rak…"
              : "Cari transaksi, barang, Kode Barang, rak…"
          }
          value={q}
          onChange={(e) => reset(() => setQ(e.target.value))}
        />
        <Input
          aria-label="Tanggal mulai"
          type="date"
          className="w-auto"
          value={from}
          onChange={(e) => reset(() => setFrom(e.target.value))}
        />
        <Input
          aria-label="Tanggal akhir"
          type="date"
          className="w-auto"
          value={to}
          onChange={(e) => reset(() => setTo(e.target.value))}
        />
        {!productId && (
          <select
            aria-label="Filter barang"
            value={product}
            onChange={(e) => reset(() => setProduct(e.target.value))}
          >
            <option value="">Semua barang (cari untuk menyaring)</option>
            {products.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter rak"
          value={rack}
          onChange={(e) => reset(() => setRack(e.target.value))}
        >
          <option value="">Semua posisi</option>
          {locations.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.room_name} / {l.code}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter status"
          value={status}
          onChange={(e) => reset(() => setStatus(e.target.value))}
        >
          <option value="">Semua status</option>
          {["PENDING", "APPROVED", "CANCELLED"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Urutan histori"
          value={sort}
          onChange={(e) => reset(() => setSort(e.target.value))}
        >
          <option value="scanned_at">Waktu scan</option>
          <option value="approved_at">Waktu approve</option>
          <option value="quantity">Quantity</option>
          <option value="sku">Kode Barang</option>
        </select>
        <select
          aria-label="Arah urutan"
          value={direction}
          onChange={(e) => reset(() => setDirection(e.target.value))}
        >
          <option value="desc">Terbaru / terbesar</option>
          <option value="asc">Terlama / terkecil</option>
        </select>
        <Button asChild variant="outline">
          <a href={"/api/history/" + type + "?" + params + "&export=csv"}>
            <Download />
            CSV
          </a>
        </Button>
      </div>
      <State
        error={list.error}
        loading={!list.data && list.loading}
        empty={list.data?.items.length === 0}
      />
      {!!list.data?.items.length && (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {[
                  ...(showReservation ? ["No Reservasi"] : []),
                  "Nomor Transaksi",
                  "Tanggal / Jam Scan",
                  "Kode Barang",
                  "Nama Barang",
                  "Lokasi",
                  "Ruangan",
                  "Qty",
                  "Sebelum",
                  "Sesudah",
                  "Approved At",
                  "Cancelled At",
                  "Petugas",
                  "Status",
                  "Alasan",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((t) => (
                <tr key={t.id}>
                  {showReservation && (
                    <td className="font-mono text-sm font-bold">
                      {t.reservation_number || "—"}
                    </td>
                  )}
                  <td className="font-semibold">{t.transaction_number}</td>
                  <td>{timestamp(t.scanned_at, settings.data?.timezone)}</td>
                  <td>{t.sku}</td>
                  <td>
                    {editable &&
                    t.status === "APPROVED" &&
                    t.transaction_type !== "ADJUSTMENT" ? (
                      <button
                        type="button"
                        title="Klik untuk merevisi jumlah atau no reservasi"
                        className="text-left font-semibold text-emerald-700 hover:underline"
                        onClick={() => setEditing(t)}
                      >
                        {t.name}
                      </button>
                    ) : (
                      t.name
                    )}
                  </td>
                  <td>{t.location_code}</td>
                  <td>{t.room_name || "— (histori lama)"}</td>
                  <td className="font-bold">{t.quantity ?? "—"}</td>
                  <td>{t.stock_before ?? "—"}</td>
                  <td>{t.stock_after ?? "—"}</td>
                  <td>{timestamp(t.approved_at, settings.data?.timezone)}</td>
                  <td>{timestamp(t.cancelled_at, settings.data?.timezone)}</td>
                  <td>{t.actor_name || "—"}</td>
                  <td>
                    <Badge value={t.status} />
                  </td>
                  <td className="max-w-xs whitespace-pre-line">
                    {t.notes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {list.data && (
        <Pager page={page} total={list.data.total} onPage={setPage} />
      )}
      {editing && (
        <RevisionDialog
          key={editing.id}
          item={editing}
          timezone={settings.data?.timezone}
          onClose={() => setEditing(undefined)}
          onSaved={() => void list.reload()}
        />
      )}
    </section>
  );
}
/** Jendela revisi transaksi IN/OUT yang salah input (dibuka dengan klik nama barang). */
function RevisionDialog({
  item,
  timezone,
  onClose,
  onSaved,
}: {
  item: StockTransaction;
  timezone?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const outbound = item.transaction_type === "OUT";
  const [quantity, setQuantity] = useState(String(item.quantity ?? ""));
  const [reservation, setReservation] = useState(item.reservation_number ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const decimal = allowsDecimal(item.unit);
  const amount = Number(quantity.replace(",", "."));
  const quantityValid =
    quantity.trim() !== "" && amount > 0 && validAmount(amount, item.unit);
  const quantityChanged = quantityValid && amount !== item.quantity;
  const reservationValid = !outbound || /^\d{7}$/.test(reservation);
  const reservationChanged =
    outbound && reservationValid && reservation !== (item.reservation_number ?? "");
  // Stok ikut berubah sebesar selisih: IN lebih banyak → naik, OUT lebih banyak → turun.
  const delta = quantityChanged
    ? roundStock((amount - (item.quantity ?? 0)) * (outbound ? -1 : 1))
    : 0;
  const stockAfter = roundStock(item.stock + delta);
  const error = !quantityValid
    ? decimal
      ? "Isi jumlah lebih dari 0 (maks. 3 angka di belakang koma)."
      : "Isi jumlah bilangan bulat lebih dari 0."
    : !reservationValid
      ? "No reservasi harus tepat 7 angka."
      : stockAfter < 0
        ? `Revisi membuat stok minus (stok saat ini ${item.stock} ${item.unit}).`
        : "";
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="m-auto w-[min(92vw,32rem)] rounded-xl p-0 backdrop:bg-black/40"
    >
      <form
        className="p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (error || (!quantityChanged && !reservationChanged)) return;
          const summary = [
            quantityChanged &&
              `Jumlah: ${item.quantity} → ${amount} ${item.unit}`,
            reservationChanged &&
              `No reservasi: ${item.reservation_number ?? "—"} → ${reservation}`,
            delta !== 0 &&
              `Stok barang: ${item.stock} → ${stockAfter} ${item.unit}`,
          ]
            .filter(Boolean)
            .join("\n");
          if (!confirm(`Simpan revisi ${item.transaction_number}?\n\n${summary}`))
            return;
          setBusy(true);
          try {
            await write(
              `transactions/${item.id}/revise`,
              {
                ...(quantityChanged ? { quantity: amount } : {}),
                ...(reservationChanged ? { reservation_number: reservation } : {}),
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              },
              "PATCH",
            );
            toast.success(`${item.transaction_number} direvisi`);
            onSaved();
            dialog.current?.close();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-bold text-lg">Revisi transaksi</h2>
        <p className="text-xs text-slate-500 mt-1">
          {item.transaction_number} ·{" "}
          {outbound ? "Barang keluar" : "Barang masuk"} ·{" "}
          {timestamp(item.scanned_at, timezone)}
        </p>
        <div className="bg-slate-50 rounded-lg p-3 mt-4 mb-4">
          <p className="font-mono text-sm font-bold">{item.sku}</p>
          <p className="text-sm">{item.name}</p>
          <p className="text-xs text-slate-500 mt-1">
            Stok saat ini: {item.stock} {item.unit}
          </p>
        </div>
        <label htmlFor="revise-quantity">
          Jumlah {outbound ? "keluar" : "masuk"} ({item.unit})
        </label>
        <Input
          id="revise-quantity"
          type="number"
          min="0"
          step={decimal ? "0.001" : "1"}
          inputMode={decimal ? "decimal" : "numeric"}
          required
          autoFocus
          value={quantity}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setQuantity(e.target.value)}
          className="mb-4"
        />
        {outbound && (
          <>
            <label htmlFor="revise-reservation">No reservasi (7 angka)</label>
            <Input
              id="revise-reservation"
              inputMode="numeric"
              maxLength={7}
              required
              value={reservation}
              onChange={(e) =>
                setReservation(e.target.value.replace(/\D/g, "").slice(0, 7))
              }
              className="mb-4 font-mono"
            />
          </>
        )}
        <label htmlFor="revise-reason">Alasan revisi (opsional)</label>
        <Input
          id="revise-reason"
          maxLength={500}
          placeholder="mis. salah ketik jumlah"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error ? (
          <p className="text-sm text-red-600 mt-3">{error}</p>
        ) : delta !== 0 ? (
          <p className="text-sm mt-3">
            Stok barang akan {delta > 0 ? "naik" : "turun"} {Math.abs(delta)}{" "}
            {item.unit}: {item.stock} → <b>{stockAfter}</b>
          </p>
        ) : null}
        <div className="flex justify-end gap-2 mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => dialog.current?.close()}
          >
            Batal
          </Button>
          <Button
            disabled={
              busy || !!error || (!quantityChanged && !reservationChanged)
            }
          >
            {busy ? "Menyimpan…" : "Simpan revisi"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
const historyTabs: { type: HistoryType; href: string; label: string }[] = [
  { type: "all", href: "/history", label: "Semua" },
  { type: "in", href: "/history/in", label: "Barang masuk" },
  { type: "out", href: "/history/out", label: "Barang keluar" },
  { type: "reservations", href: "/reservations", label: "No reservasi" },
  { type: "adjustments", href: "/history/adjustments", label: "Koreksi stok" },
];
/** Satu halaman Riwayat: barang masuk, keluar, no reservasi, dan koreksi stok. */
export function HistoryHub({ type }: { type: HistoryType }) {
  const tab = historyTabs.find((t) => t.type === type) ?? historyTabs[0];
  return (
    <>
      <Heading title="Riwayat" />
      <Tabs
        items={historyTabs.map((t) => ({
          key: t.type,
          label: t.label,
          href: t.href,
          active: t.type === tab.type,
        }))}
      />
      <HistoryPage
        key={tab.type}
        type={tab.type}
        bare
        editable={tab.type !== "adjustments"}
      />
    </>
  );
}
/** Kelola kategori barang; ditampilkan di halaman Pengaturan. */
function CategoryManager() {
  const kind = "categories";
  const list = useData<Lookup[]>(kind);
  const [editing, setEditing] = useState<Lookup>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const filtered = (list.data || []).filter((c) =>
    c.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="grid lg:grid-cols-[1fr_340px] gap-6">
        <div>
          <Input
            aria-label="Cari kategori"
            placeholder="Cari kategori…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="mb-4"
          />
          <State
            error={list.error}
            loading={!list.data && list.loading}
            empty={!!list.data && !filtered.length}
          />
          {!!filtered.length && (
            <Card className="p-0 overflow-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Nama</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice((page - 1) * 20, page * 20).map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>
                        <div className="flex gap-3 text-xs">
                          <button
                            className="text-emerald-700"
                            onClick={() => {
                              setEditing(c);
                              setName(c.name);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="text-red-700"
                            disabled={busy}
                            onClick={async () => {
                              if (!confirm(`Hapus kategori ${c.name}?`)) return;
                              setBusy(true);
                              try {
                                await write("categories/" + c.id, {}, "DELETE");
                                await list.reload();
                                toast.success("Kategori dihapus");
                              } catch (e) {
                                toast.error((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <Pager page={page} total={filtered.length} onPage={setPage} />
        </div>
        <Card className="h-fit">
          <h2 className="font-bold mb-4">
            {editing ? "Edit" : "Tambah"} kategori
          </h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await write(
                  "categories" + (editing ? "/" + editing.id : ""),
                  { name },
                  editing ? "PATCH" : "POST",
                );
                await list.reload();
                setEditing(undefined);
                setName("");
                toast.success("Kategori disimpan");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="category-name">Nama kategori</label>
            <Input
              id="category-name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mb-4"
            />
            <div className="flex gap-2">
              <Button disabled={busy}>Simpan</Button>
              {editing && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(undefined);
                    setName("");
                  }}
                >
                  Batal
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
const correctionReasons = [
  "Rusak",
  "Hilang",
  "Kedaluwarsa",
  "Ditemukan",
  "Selisih stock opname",
  "Salah input",
  "Lainnya",
];
const legend = "text-xs font-semibold text-[#526272] mb-1.5";
function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
/** Koreksi stok satu barang (di halaman detail barang): ketik jumlah sebenarnya di gudang. */
export function StockCorrection({
  product,
  onSaved,
}: {
  product: Product;
  onSaved: () => Promise<void> | void;
}) {
  const [actual, setActual] = useState("");
  const [edited, setEdited] = useState(false);
  const [prefilledFor, setPrefilledFor] = useState("");
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const section = useRef<HTMLElement>(null);
  // Kolom jumlah diisi stok di web, dan ikut berubah selama user belum mengetik.
  const prefillKey = `${product.id}:${product.stock}`;
  if (!edited && prefilledFor !== prefillKey) {
    setPrefilledFor(prefillKey);
    setActual(String(product.stock));
  }
  useEffect(() => {
    // Dari tautan "Koreksi stok" di daftar barang (/products/:id#koreksi).
    if (location.hash === "#koreksi")
      section.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const decimal = allowsDecimal(product.unit);
  const result =
    actual.trim() !== ""
      ? correction(product.stock, Number(actual.replace(",", ".")), product.unit)
      : undefined;
  const preview = result && "after" in result ? result : undefined;
  const invalid = result && "error" in result && !result.same ? result.error : "";
  const notes = detail.trim() ? `${reason}: ${detail.trim()}` : reason;
  const needsDetail = reason === "Lainnya" && detail.trim().length < 3;
  return (
    <section id="koreksi" ref={section} className="scroll-mt-6">
      <h2 className="font-bold text-lg">Koreksi stok</h2>
      <p className="text-xs text-slate-500 mt-1 mb-4">
        Samakan stok di web dengan jumlah barang yang sebenarnya ada di gudang,
        misalnya karena barang rusak, hilang, atau hasil stock opname.
      </p>
      <Card>
        <form
          className="grid lg:grid-cols-2 gap-8"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!preview || !reason || needsDetail) return;
            if (
              !confirm(
                `Simpan koreksi stok?\n\n${product.sku} · ${product.name}\nStok di web: ${product.stock} → ${preview.after} ${product.unit} (selisih ${signed(preview.delta)})\nAlasan: ${notes}`,
              )
            )
              return;
            setBusy(true);
            try {
              await write("adjustments", {
                product_id: product.id,
                expected_stock: product.stock,
                physical_stock: preview.after,
                notes,
              });
              toast.success(
                `Stok ${product.sku} sekarang ${preview.after} ${product.unit} (selisih ${signed(preview.delta)})`,
              );
              setReason("");
              setDetail("");
              await onSaved();
              // Kolom jumlah kembali mengikuti stok terbaru.
              setEdited(false);
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <label htmlFor="correction-actual">
              Jumlah sebenarnya di gudang ({product.unit})
            </label>
            <Input
              id="correction-actual"
              type="number"
              min="0"
              max="2147483647"
              step={decimal ? "0.001" : "1"}
              inputMode={decimal ? "decimal" : "numeric"}
              required
              value={actual}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setEdited(true);
                setActual(e.target.value);
              }}
              className="text-lg font-semibold"
            />
            {invalid ? (
              <p className="text-sm text-red-600 mt-2">{invalid}</p>
            ) : (
              <p className="text-xs text-slate-500 mt-2">
                Ganti angka ini dengan jumlah yang benar-benar ada di gudang.
                Selisihnya dihitung otomatis.
                {decimal ? " Boleh berkoma (maks. 3 angka di belakang koma)." : ""}
              </p>
            )}
            <div className="grid grid-cols-3 bg-slate-50 rounded-lg p-4 mt-4 text-center">
              <div>
                <p className="text-xs text-slate-500">Stok di web</p>
                <p className="text-xl font-bold mt-2">{product.stock}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Jumlah sebenarnya</p>
                <p className="text-xl font-bold mt-2">{preview?.after ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Selisih</p>
                <p
                  className={`text-xl font-bold mt-2 ${preview ? (preview.delta < 0 ? "text-red-600" : "text-emerald-700") : ""}`}
                >
                  {preview ? signed(preview.delta) : "—"}
                </p>
              </div>
            </div>
          </div>
          <div>
            <fieldset>
              <legend className={legend}>Alasan (wajib)</legend>
              <div className="flex flex-wrap gap-2 mb-3">
                {correctionReasons.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={reason === r}
                    onClick={() => setReason(r)}
                    className={`rounded-full border px-3 py-1 text-xs ${reason === r ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-300 bg-white"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </fieldset>
            <label htmlFor="correction-detail">
              Keterangan {reason === "Lainnya" ? "(wajib)" : "(opsional)"}
            </label>
            <textarea
              id="correction-detail"
              maxLength={1900}
              placeholder="mis. 2 pcs pecah saat bongkar muat"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              className="w-full"
            />
            <Button
              className="mt-4"
              disabled={busy || !preview || !reason || needsDetail}
            >
              {busy ? "Menyimpan…" : "Simpan koreksi"}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
export function SettingsPage() {
  return (
    <>
      <Heading title="Pengaturan" />
      <h2 className="font-bold text-lg mb-4">Kategori barang</h2>
      <CategoryManager />
    </>
  );
}
