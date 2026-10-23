"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";
import { write, timestamp } from "@/lib/client";
import { allowsDecimal, correction, type CorrectionMode } from "@/lib/stock";
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
import { Heading, State, Badge, Pager, useData } from "./shared";
export function HistoryPage({
  type,
  productId,
  compact = false,
}: {
  type: "in" | "out" | "adjustments" | "reservations";
  productId?: number;
  compact?: boolean;
}) {
  const showReservation = type === "out" || type === "reservations";
  const { version } = useLive();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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
    type === "in"
      ? "Riwayat barang masuk"
      : type === "out"
        ? "Riwayat barang keluar"
        : type === "reservations"
          ? "Nomor reservasi"
          : "Riwayat koreksi stok";
  return (
    <section>
      {compact ? (
        <h2 className="font-bold text-lg mb-4">{title}</h2>
      ) : (
        <Heading
          title={title}
          description={
            type === "reservations"
              ? "Barang keluar dari aplikasi scanner HP. No reservasi adalah identitas pengambilan dan divisi pengambil barang."
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
                  <td>{t.name}</td>
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
                  <td className="max-w-xs whitespace-normal">
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
    </section>
  );
}
export function LookupsPage({ kind }: { kind: "categories" }) {
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
      <Heading
        title="Kategori"
        description="Kelompokkan barang untuk memudahkan pencarian."
      />
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
const correctionModes: { mode: CorrectionMode; label: string; hint: string }[] = [
  { mode: "reduce", label: "Kurangi", hint: "Rusak, hilang, kedaluwarsa" },
  { mode: "add", label: "Tambah", hint: "Ditemukan / kurang dicatat" },
  { mode: "set", label: "Isi stok fisik", hint: "Hasil hitung stock opname" },
];
const quantityLabels: Record<CorrectionMode, string> = {
  reduce: "3. Jumlah yang dikurangi",
  add: "3. Jumlah yang ditambah",
  set: "3. Stok fisik hasil hitung",
};
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
export function AdjustmentsPage({ productId }: { productId?: number }) {
  const { version } = useLive();
  const [search, setSearch] = useState("");
  const products = useData<{ items: InventoryProduct[] }>(
    "products?limit=100&q=" + encodeURIComponent(search),
    version,
  );
  const [selectedId, setSelectedId] = useState(productId);
  // Barang terpilih dimuat langsung agar stok sistem selalu terbaru (ikut update otomatis).
  const product = useData<Product>(
    selectedId ? "products/" + selectedId : null,
    version,
  );
  const selected = product.data?.id === selectedId ? product.data : undefined;
  const [mode, setMode] = useState<CorrectionMode>("reduce");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const decimal = allowsDecimal(selected?.unit);
  const result =
    selected && quantity.trim() !== ""
      ? correction(
          selected.stock,
          mode,
          Number(quantity.replace(",", ".")),
          selected.unit,
        )
      : undefined;
  const preview = result && "after" in result ? result : undefined;
  const notes = detail.trim() ? `${reason}: ${detail.trim()}` : reason;
  const needsDetail = reason === "Lainnya" && detail.trim().length < 3;
  const options = products.data?.items ?? [];
  return (
    <>
      <Heading
        title="Koreksi stok"
        description="Samakan stok di web dengan jumlah barang di gudang, misalnya barang rusak, hilang, atau hasil stock opname."
      />
      <Card className="mb-9">
        <form
          className="grid lg:grid-cols-2 gap-8"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!selected || !preview || !reason || needsDetail) return;
            if (
              !confirm(
                `Simpan koreksi stok?\n\n${selected.sku} · ${selected.name}\nStok: ${selected.stock} → ${preview.after} ${selected.unit} (${signed(preview.delta)})\nAlasan: ${notes}`,
              )
            )
              return;
            setBusy(true);
            try {
              await write("adjustments", {
                product_id: selected.id,
                expected_stock: selected.stock,
                physical_stock: preview.after,
                notes,
              });
              toast.success(
                `Stok ${selected.sku} dikoreksi: ${selected.stock} → ${preview.after} ${selected.unit}`,
              );
              setQuantity("");
              setReason("");
              setDetail("");
              setRevision((v) => v + 1);
              await product.reload();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <label htmlFor="adjust-search">
              1. Cari barang (nama / Kode Barang / rak)
            </label>
            <Input
              id="adjust-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-3"
            />
            <select
              aria-label="Pilih barang"
              className="w-full"
              required
              value={selectedId ?? ""}
              onChange={(e) => {
                setSelectedId(Number(e.target.value) || undefined);
                setQuantity("");
              }}
            >
              <option value="">Pilih barang</option>
              {selected && !options.some((p) => p.id === selected.id) && (
                <option value={selected.id}>
                  {selected.sku} · {selected.name} · {selected.location_code}
                </option>
              )}
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name} · {p.location_code}
                </option>
              ))}
            </select>
            <State error={products.error || product.error} />
            {selected && (
              <div className="bg-slate-50 rounded-lg p-4 mt-4">
                <p className="font-mono font-bold">{selected.sku}</p>
                <p className="text-sm">{selected.name}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {selected.room_name} · {selected.location_code}
                </p>
              </div>
            )}
            <div className="grid grid-cols-3 bg-slate-50 rounded-lg p-4 mt-4 text-center">
              <div>
                <p className="text-xs text-slate-500">Stok sistem</p>
                <p className="text-xl font-bold mt-2">
                  {selected?.stock ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Stok baru</p>
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
            {selected && (
              <p className="text-xs text-slate-500 mt-2 text-center">
                Satuan {selected.unit}
                {decimal ? " · boleh berkoma (maks. 3 angka di belakang koma)" : ""}
              </p>
            )}
          </div>
          <div>
            <fieldset className="mb-5">
              <legend className={legend}>2. Jenis koreksi</legend>
              <div className="grid grid-cols-3 gap-2">
                {correctionModes.map((m) => (
                  <button
                    key={m.mode}
                    type="button"
                    aria-pressed={mode === m.mode}
                    onClick={() => setMode(m.mode)}
                    className={`rounded-lg border p-3 text-left ${mode === m.mode ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"}`}
                  >
                    <span className="block text-sm font-semibold">{m.label}</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      {m.hint}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
            <label htmlFor="correction-quantity">{quantityLabels[mode]}</label>
            <Input
              id="correction-quantity"
              type="number"
              min="0"
              max="2147483647"
              step={decimal ? "0.001" : "1"}
              inputMode={decimal ? "decimal" : "numeric"}
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            {result && "error" in result && (
              <p className="text-sm text-red-600 mt-2">{result.error}</p>
            )}
            <fieldset className="mt-5">
              <legend className={legend}>4. Alasan (wajib)</legend>
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
              placeholder="mis. 3 pcs pecah saat bongkar muat"
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
      <HistoryPage key={revision} type="adjustments" compact />
    </>
  );
}
export function SettingsPage() {
  const { data, error, loading } = useData<{
    timezone: string;
    app_url: string;
    cookie_secure: boolean;
  }>("settings");
  return (
    <>
      <Heading
        title="Pengaturan"
        description="Konfigurasi server dan panduan singkat perangkat."
      />
      <State error={error} loading={loading} />
      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <h2 className="font-bold mb-4">Konfigurasi aktif</h2>
          <dl className="space-y-4">
            {[
              ["Timezone", data?.timezone],
              ["APP_URL", data?.app_url],
              [
                "Cookie HTTPS",
                data?.cookie_secure ? "Aktif" : "Nonaktif (HTTP lokal)",
              ],
              ["Database", "MySQL / MariaDB · mysql2"],
              ["Realtime", "SSE + fallback polling"],
            ].map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs text-slate-400">{key}</dt>
                <dd className="mt-1">{value || "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-slate-400 mt-6">
            Ubah .env.local di komputer lalu restart aplikasi untuk menerapkan
            konfigurasi.
          </p>
        </Card>
        <Card>
          <h2 className="font-bold mb-4">Aplikasi scanner HP</h2>
          <ol className="list-decimal pl-5 space-y-3 text-sm text-slate-600">
            <li>Hubungkan HP dan komputer ke Wi-Fi yang sama.</li>
            <li>
              Pasang aplikasi Warehouse Scanner (APK) di HP Android.
            </li>
            <li>
              Isi alamat server dengan IPv4 komputer (lihat ipconfig), misalnya{" "}
              <span className="font-mono">https://192.168.1.10:3000</span>,
              lalu login.
            </li>
            <li>
              Pilih IN atau OUT, scan QR barang, lalu ketik jumlah.
            </li>
            <li>
              Untuk OUT, isi no reservasi 7 angka. Stok langsung diperbarui
              setelah menekan Selesai.
            </li>
          </ol>
          <p className="text-xs text-slate-400 mt-5">
            Langkah build APK, HTTPS, firewall, dan troubleshooting lengkap
            tersedia di README.md.
          </p>
        </Card>
      </div>
    </>
  );
}
