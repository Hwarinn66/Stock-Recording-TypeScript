"use client";
import { useState } from "react";
import type { LocationLookup } from "@/types";
import { Input } from "@/components/ui/input";

export function LocationPicker({
  rooms,
  blocks,
  racks,
  locations,
  initialId,
  productId,
}: {
  rooms: LocationLookup[];
  blocks: LocationLookup[];
  racks: LocationLookup[];
  locations: LocationLookup[];
  initialId?: number;
  productId?: number;
}) {
  const initial = locations.find((l) => l.id === initialId);
  const [room, setRoom] = useState(String(initial?.room_id || ""));
  const [block, setBlock] = useState(String(initial?.block_id || ""));
  const [rack, setRack] = useState(String(initial?.rack_id || ""));
  const [position, setPosition] = useState(
    initial?.position_number ? String(initial.position_number) : "",
  );

  // Posisi yang sudah ada belum tentu terisi: product_id null berarti kosong.
  const existing = position
    ? locations.find(
        (item) =>
          String(item.rack_id) === rack &&
          item.position_number === Number(position),
      )
    : undefined;
  const takenBy =
    existing?.active && existing.product_id && existing.product_id !== productId
      ? existing.product_name
      : null;
  const inactive = !!existing && !existing.active;
  const selectedRack = racks.find((item) => String(item.id) === rack);
  const selectedBlock = blocks.find(
    (item) => item.id === selectedRack?.block_id,
  );

  return (
    <fieldset className="sm:col-span-2 rounded-xl border border-slate-200 p-4">
      <legend className="px-2 text-xs font-semibold">
        Lokasi penempatan barang
      </legend>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label htmlFor="product-room">Ruangan</label>
          <select
            id="product-room"
            className="w-full"
            required
            value={room}
            onChange={(e) => {
              setRoom(e.target.value);
              setBlock("");
              setRack("");
              setPosition("");
            }}
          >
            <option value="">Pilih ruangan</option>
            {rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="product-block">Blok</label>
          <select
            id="product-block"
            className="w-full"
            required
            disabled={!room}
            value={block}
            onChange={(e) => {
              setBlock(e.target.value);
              setRack("");
              setPosition("");
            }}
          >
            <option value="">Pilih blok</option>
            {blocks
              .filter((item) => String(item.room_id) === room)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  Blok {item.code}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor="rack_id">Rak</label>
          <select
            id="rack_id"
            name="rack_id"
            className="w-full"
            required
            disabled={!block}
            value={rack}
            onChange={(e) => {
              setRack(e.target.value);
              setPosition("");
            }}
          >
            <option value="">Pilih rak</option>
            {racks
              .filter((item) => String(item.block_id) === block)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.block_code}.{String(item.rack_number).padStart(2, "0")}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor="position_number">Nomor penempatan</label>
          <Input
            id="position_number"
            name="position_number"
            type="number"
            min={1}
            max={999999}
            step={1}
            required
            disabled={!rack}
            value={position}
            placeholder="Contoh: 1"
            onChange={(e) => setPosition(e.target.value)}
          />
        </div>
      </div>

      <p
        className={
          "text-xs mt-3 " +
          (takenBy || inactive ? "text-red-700" : "text-emerald-700")
        }
      >
        {!rack
          ? "Pilih ruangan → blok → rak, lalu ketik nomor penempatan."
          : !position
            ? "Ketik nomor penempatan yang ingin dipakai."
            : takenBy
              ? `Posisi ${position} sudah ditempati oleh ${takenBy}. Pilih nomor lain.`
              : inactive
                ? `Posisi ${position} nonaktif. Aktifkan di Lokasi Gudang atau pilih nomor lain.`
                : `${rooms.find((item) => String(item.id) === room)?.name || ""} / ${existing?.code || `${selectedBlock?.code || ""}.${String(selectedRack?.rack_number || 0).padStart(2, "0")}.${String(Number(position)).padStart(2, "0")}`} · tersedia`}
      </p>
    </fieldset>
  );
}
