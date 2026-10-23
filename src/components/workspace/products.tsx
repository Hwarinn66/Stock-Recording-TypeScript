"use client";
import { LocationPicker } from "@/components/location-picker";
import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Printer, QrCode, Plus } from "lucide-react";
import { api, write, timestamp } from "@/lib/client";
import { useLive } from "@/hooks/use-live";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  Product,
  InventoryProduct,
  Lookup,
  LocationLookup,
} from "@/types";
import { Heading, State, StockBadge, Pager, useData } from "./shared";
import { HistoryPage } from "./management";
type Movement = Product["movement_class"];
const movementLabel = (m: Movement) =>
  m === "FAST"
    ? "Fast moving"
    : m === "SLOW"
      ? "Slow moving"
      : m === "DEAD"
        ? "Dead stock"
        : "Belum diberi label";
const movementStyle = (m: Movement) =>
  m === "FAST"
    ? "bg-emerald-50 text-emerald-800"
    : m === "SLOW"
      ? "bg-amber-50 text-amber-800"
      : m === "DEAD"
        ? "bg-red-50 text-red-700"
        : "bg-slate-100 text-slate-500";
export function ProductsPage({ low = false }: { low?: boolean }) {
  const { version } = useLive();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [rack, setRack] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [stock, setStock] = useState(low ? "low" : "");
  const [active, setActive] = useState("1");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setQ(new URLSearchParams(location.search).get("q") || "");
  }, []);
  const params = new URLSearchParams({
    q,
    page: String(page),
    sort,
    direction: ["stock", "out_total"].includes(sort) ? "desc" : "asc",
    active,
    ...(category ? { category_id: category } : {}),
    ...(rack ? { location_id: rack } : {}),
    ...(roomFilter ? { room_id: roomFilter } : {}),
    ...(stock ? { stock } : {}),
  });
  const list = useData<{ items: InventoryProduct[]; total: number }>(
    "products?" + params,
    version,
  );
  const categories = useData<Lookup[]>("categories");
  const locations = useData<LocationLookup[]>("locations");
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  return (
    <>
      <Heading
        title={low ? "Stock menipis" : "Data barang"}
        description={
          low
            ? "Barang dengan stok 2 atau kurang. Segera periksa kebutuhan pengadaan."
            : "Kelola barang, lokasi rak, dan label QR Anda."
        }
      >
        <Button variant="outline" asChild>
          <a href={"/api/products?" + params + "&export=csv"}>
            <Download />
            Export CSV
          </a>
        </Button>
        <Button asChild>
          <Link href="/products/new">
            <Plus />
            Tambah Barang
          </Link>
        </Button>
      </Heading>
      <Card className="mb-5">
        <div className="flex flex-wrap gap-3">
          <Input
            aria-label="Cari barang"
            placeholder="Cari nama, kode barang, lokasi…"
            className="max-w-xs"
            value={q}
            onChange={(e) => reset(() => setQ(e.target.value))}
          />
          <select
            aria-label="Kategori"
            value={category}
            onChange={(e) => reset(() => setCategory(e.target.value))}
          >
            <option value="">Semua kategori</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter ruangan"
            value={roomFilter}
            onChange={(e) =>
              reset(() => {
                setRoomFilter(e.target.value);
                setRack("");
              })
            }
          >
            <option value="">Semua ruangan</option>
            {[
              ...new Map(
                (locations.data || []).map((l) => [l.room_id, l]),
              ).values(),
            ].map((l) => (
              <option key={l.room_id} value={l.room_id}>
                {l.room_name}
              </option>
            ))}
          </select>
          <select
            aria-label="Posisi"
            value={rack}
            onChange={(e) => reset(() => setRack(e.target.value))}
          >
            <option value="">Semua posisi</option>
            {locations.data
              ?.filter((l) => !roomFilter || l.room_id === Number(roomFilter))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.room_name} / {l.code}
                </option>
              ))}
          </select>
          <select
            aria-label="Filter stok"
            value={stock}
            onChange={(e) => reset(() => setStock(e.target.value))}
          >
            <option value="">Semua stok</option>
            <option value="low">Menipis ≤ 2</option>
            <option value="zero">Habis</option>
            <option value="safe">Aman &gt; 2</option>
          </select>
          <select
            aria-label="Status barang"
            value={active}
            onChange={(e) => reset(() => setActive(e.target.value))}
          >
            <option value="1">Aktif</option>
            <option value="0">Nonaktif</option>
            <option value="all">Semua status</option>
          </select>
          <select
            aria-label="Urutkan"
            value={sort}
            onChange={(e) => reset(() => setSort(e.target.value))}
          >
            <option value="name">Nama A–Z (default)</option>
            <option value="stock">Stok terbanyak</option>
            <option value="out_total">Total OUT terbanyak (semua waktu)</option>
            <option value="location">Lokasi A.01.01 → terakhir</option>
            <option value="movement">
              Kelompok Fast → Slow → Dead, masing-masing A–Z
            </option>
            <option value="fast">Fast moving saja · A–Z</option>
            <option value="slow">Slow moving saja · A–Z</option>
            <option value="dead">Dead stock saja · A–Z</option>
            <option value="unlabelled">Belum diberi label · A–Z</option>
            <option value="sku">Kode Barang A–Z</option>
          </select>
        </div>
        <p className="border-t border-slate-100 mt-4 pt-4 text-xs text-slate-500">
          Fast/Slow/Dead adalah label manual dari master barang. Pilih melalui
          Tambah/Edit Barang. Total OUT hanya dipakai untuk urutan OUT terbanyak
          dan tidak mengubah label.
        </p>
      </Card>
      <State
        error={list.error}
        loading={!list.data && list.loading}
        empty={list.data?.items.length === 0}
      />
      {!!list.data?.items.length && (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {[
                  "Kode Barang",
                  "Nama Barang",
                  "Kategori",
                  "Stock",
                  "Satuan",
                  "Total OUT",
                  "Pergerakan",
                  "Lokasi",
                  "Status",
                  "Action",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p, index) => (
                <Fragment key={p.id}>
                  {sort === "movement" &&
                    (index === 0 ||
                      list.data?.items[index - 1]?.movement_class !==
                        p.movement_class) && (
                      <tr>
                        <th
                          colSpan={10}
                          scope="rowgroup"
                          className={movementStyle(p.movement_class)}
                        >
                          {movementLabel(p.movement_class)} · Nama A–Z
                        </th>
                      </tr>
                    )}
                  <tr>
                    <td className="font-mono text-base font-bold text-slate-900">
                      {p.sku}
                    </td>
                    <td className="font-semibold">
                      <Link href={"/products/" + p.id}>{p.name}</Link>
                    </td>
                    <td className="text-xs">{p.category_name}</td>
                    <td
                      className={`font-bold ${p.stock <= 2 ? "text-red-700" : ""}`}
                    >
                      {p.stock}
                    </td>
                    <td className="text-xs">{p.unit}</td>
                    <td className="font-semibold tabular-nums">
                      {p.out_total}
                    </td>
                    <td>
                      <span
                        className={`text-[10px] font-bold px-2 py-1 rounded ${movementStyle(p.movement_class)}`}
                      >
                        {movementLabel(p.movement_class).toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className="bg-slate-100 rounded px-2 py-1 text-xs">
                        {p.location_code}
                      </span>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {p.room_name}
                      </p>
                    </td>
                    <td>
                      {p.active ? (
                        <StockBadge stock={p.stock} />
                      ) : (
                        <span className="text-xs text-slate-400">NONAKTIF</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-3 text-xs text-emerald-700">
                        <Link href={"/products/" + p.id}>Detail</Link>
                        <Link href={`/products/${p.id}/edit`}>Edit</Link>
                        <Link
                          aria-label={"QR " + p.name}
                          href={`/products/${p.id}/qr`}
                        >
                          <QrCode size={16} />
                        </Link>
                        <button
                          className="text-slate-500"
                          onClick={async () => {
                            if (
                              !confirm(
                                `${p.active ? "Nonaktifkan" : "Aktifkan"} ${p.name}?`,
                              )
                            )
                              return;
                            try {
                              await write(
                                "products/" + p.id,
                                { active: !p.active },
                                "PATCH",
                              );
                              toast.success("Status barang diperbarui");
                              void list.reload();
                            } catch (e) {
                              toast.error((e as Error).message);
                            }
                          }}
                        >
                          {p.active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {list.data && (
        <Pager page={page} total={list.data.total} onPage={setPage} />
      )}
    </>
  );
}
export function ProductForm({ id }: { id?: number }) {
  const router = useRouter();
  const categories = useData<Lookup[]>("categories");
  const rooms = useData<LocationLookup[]>("rooms");
  const blocks = useData<LocationLookup[]>("blocks");
  const racks = useData<LocationLookup[]>("racks");
  const locations = useData<LocationLookup[]>("locations");
  const [initial, setInitial] = useState<Product>();
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (id)
      api<Product>("products/" + id)
        .then((p) => {
          setInitial(p);
          setImage(p.image);
        })
        .catch((e) => setError(e.message));
  }, [id]);
  return (
    <>
      <Heading
        title={id ? "Edit barang" : "Tambah barang"}
        description="Satu barang, satu posisi aktif, satu QR. Stok awal barang baru adalah 0."
      />
      <State
        error={
          error ||
          categories.error ||
          rooms.error ||
          blocks.error ||
          racks.error ||
          locations.error
        }
        loading={
          (!!id && !initial) ||
          !categories.data ||
          !rooms.data ||
          !blocks.data ||
          !racks.data ||
          !locations.data
        }
      />
      {(!id || initial) &&
        categories.data &&
        rooms.data &&
        blocks.data &&
        racks.data &&
        locations.data && (
        <form
          key={initial?.id || "new"}
          className="max-w-3xl"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const input = {
              name: String(f.get("name")),
              category_id: Number(f.get("category_id")),
              unit: String(f.get("unit")),
              movement_class: f.get("movement_class") || null,
              rack_id: Number(f.get("rack_id")),
              position_number: Number(f.get("position_number")),
              description: String(f.get("description")),
              image,
              ...(!id ? { sku: String(f.get("sku")) } : {}),
            };
            if (
              initial &&
              (input.rack_id !== initial.rack_id ||
                input.position_number !== initial.position_number)
            ) {
              const targetRack = racks.data?.find(
                (item) => item.id === input.rack_id,
              );
              const targetCode = `${targetRack?.block_code || ""}.${String(
                targetRack?.rack_number || 0,
              ).padStart(2, "0")}.${String(input.position_number).padStart(
                2,
                "0",
              )}`;
              if (
                !confirm(
                  `Anda akan memindahkan ${initial.name} dari posisi ${initial.location_code} ke posisi ${targetCode}. Lanjutkan?`,
                )
              )
                return;
            }
            setBusy(true);
            try {
              const result = await write<{ id: number }>(
                "products" + (id ? "/" + id : ""),
                input,
                id ? "PATCH" : "POST",
              );
              toast.success(
                id
                  ? "Barang diperbarui"
                  : "Barang dibuat. QR otomatis tersedia.",
              );
              router.push(`/products/${result.id}/qr`);
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Card>
            <h2 className="text-base font-semibold mb-5">Informasi barang</h2>
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="sku">Kode Barang</label>
                <Input
                  id="sku"
                  name="sku"
                  required
                  maxLength={64}
                  defaultValue={initial?.sku}
                  disabled={!!id}
                  placeholder="a0001"
                />
                <p className="text-xs text-slate-400 mt-2">
                  Kode unik setiap varian: a0001 untuk Ember 1 kg, a0002 untuk
                  Ember 1,2 kg. Cantumkan kapasitas pada nama barang.
                </p>
              </div>
              <div>
                <label htmlFor="name">Nama Barang</label>
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={255}
                  defaultValue={initial?.name}
                />
              </div>
              <div>
                <label htmlFor="category_id">Kategori</label>
                <select
                  id="category_id"
                  name="category_id"
                  className="w-full"
                  required
                  defaultValue={initial?.category_id || ""}
                >
                  <option value="" disabled>
                    Pilih kategori
                  </option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="unit">Satuan</label>
                <Input
                  id="unit"
                  name="unit"
                  required
                  maxLength={20}
                  defaultValue={initial?.unit || "PCS"}
                />
              </div>
              <div>
                <label htmlFor="movement_class">
                  Label pergerakan (manual)
                </label>
                <select
                  id="movement_class"
                  name="movement_class"
                  defaultValue={initial?.movement_class || ""}
                  className="w-full"
                >
                  <option value="">Belum diberi label</option>
                  <option value="FAST">Fast moving</option>
                  <option value="SLOW">Slow moving</option>
                  <option value="DEAD">Dead stock</option>
                </select>
                <p className="text-xs text-slate-400 mt-2">
                  Pilih sesuai klasifikasi gudang Anda. Tidak dihitung dari OUT.
                </p>
              </div>
              <LocationPicker
                rooms={rooms.data}
                blocks={blocks.data}
                racks={racks.data}
                locations={locations.data}
                initialId={initial?.location_id}
                productId={id}
              />
              <div>
                <label htmlFor="image">Foto (opsional, maks. 1 MB)</label>
                <Input
                  id="image"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1000000) {
                      toast.error("Ukuran maksimal 1 MB");
                      e.target.value = "";
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => setImage(String(reader.result));
                    reader.readAsDataURL(file);
                  }}
                />
                {image && (
                  <div className="mt-2 flex items-center gap-3">
                    <img
                      src={image}
                      alt="Foto barang"
                      className="size-16 object-cover rounded"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setImage(null)}
                    >
                      Hapus foto
                    </Button>
                  </div>
                )}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="description">Deskripsi</label>
                <textarea
                  id="description"
                  name="description"
                  maxLength={5000}
                  className="w-full"
                  defaultValue={initial?.description || ""}
                />
              </div>
            </div>
            <div className="mt-5 p-4 rounded-lg bg-emerald-50 text-emerald-800 text-xs">
              Stok dikelola melalui IN, OUT, atau Stock Adjustment. QR unik
              dibuat otomatis saat barang disimpan.
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Kembali
              </Button>
              <Button
                disabled={
                  busy ||
                  !categories.data ||
                  !rooms.data ||
                  !blocks.data ||
                  !racks.data ||
                  !locations.data
                }
              >
                {busy ? "Menyimpan…" : "Simpan Barang"}
              </Button>
            </div>
            <State
              error={
                categories.error ||
                rooms.error ||
                blocks.error ||
                racks.error ||
                locations.error
              }
            />
          </Card>
        </form>
      )}
    </>
  );
}
export function ProductDetail({
  id,
  qrOnly = false,
}: {
  id: number;
  qrOnly?: boolean;
}) {
  const {
    data: p,
    error,
    loading,
    reload,
  } = useData<Product>("products/" + id);
  const settings = useData<{ timezone: string }>("settings");
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState(false);
  if (!p) return <State error={error} loading={loading} />;
  const src = `/api/products/${id}/qr?v=${rev}`;
  return (
    <>
      <Heading
        title={qrOnly ? "QR barang" : p.name}
        description={`${p.sku} · ${p.room_name} · ${p.location_code}`}
      >
        <Button variant="outline" asChild>
          <Link href={`/products/${id}/edit`}>Edit Barang</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/products">Daftar Barang</Link>
        </Button>
      </Heading>
      <div
        className={qrOnly ? "max-w-lg mx-auto" : "grid lg:grid-cols-2 gap-6"}
      >
        <Card className="print-label text-center">
          <h2 className="font-bold text-xl uppercase">{p.name}</h2>
          <p className="text-[10px] tracking-widest text-slate-500 mt-4">
            KODE BARANG
          </p>
          <p className="font-mono text-3xl font-black tracking-wide">{p.sku}</p>
          <p className="font-bold mt-1">LOKASI: {p.location_code}</p>
          <p className="text-xs mt-1">{p.room_name}</p>
          <img
            src={src}
            alt={"QR " + p.name}
            className="w-64 h-64 mx-auto my-3"
          />
          <p className="text-[10px] text-slate-400">
            WAREHOUSE · SCAN UNTUK IN / OUT
          </p>
          <div className="no-print flex flex-wrap gap-2 mt-5 justify-center">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer />
              Print QR
            </Button>
            <Button asChild variant="outline">
              <a href={src} download={`${p.sku}-qr.svg`}>
                <Download />
                Download QR
              </a>
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={async () => {
                if (
                  !confirm(
                    "Regenerate QR? Label lama tidak berlaku lagi. Cetak dan pasang label baru.",
                  )
                )
                  return;
                setBusy(true);
                try {
                  await write("products/" + id + "/qr");
                  setRev((v) => v + 1);
                  await reload();
                  toast.success("QR baru tersedia. Cetak ulang label.");
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Regenerate QR
            </Button>
          </div>
        </Card>
        {!qrOnly && (
          <Card className="no-print">
            <h2 className="font-semibold mb-5">Informasi persediaan</h2>
            {p.image && (
              <img
                src={p.image}
                alt={p.name}
                className="w-24 h-24 object-cover rounded-lg mb-4"
              />
            )}
            <div className="text-4xl font-bold mb-3">
              {p.stock} <span className="text-sm text-slate-400">{p.unit}</span>
            </div>
            <StockBadge stock={p.stock} />
            <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
              {[
                ["Kategori", p.category_name],
                ["Status", p.active ? "Aktif" : "Nonaktif"],
                ["Ruangan", p.room_name || "—"],
                ["Lokasi", p.location_code],
                ["Satuan", p.unit],
                ["Kode Barang", p.sku],
                ["Label pergerakan", movementLabel(p.movement_class)],
                ["Dibuat", timestamp(p.created_at, settings.data?.timezone)],
                [
                  "Diperbarui",
                  timestamp(p.updated_at, settings.data?.timezone),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-slate-400 mb-1">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 text-slate-500">
              {p.description || "Tidak ada deskripsi."}
            </p>
          </Card>
        )}
      </div>
      {!qrOnly && (
        <div className="no-print mt-8 space-y-8">
          <HistoryPage type="in" productId={id} compact />
          <HistoryPage type="out" productId={id} compact />
        </div>
      )}
    </>
  );
}
